"""
Windows PE 导入表诊断工具（含传递依赖分析）。

解析 cargo test --lib 生成的测试二进制文件的导入表，
逐函数与系统 DLL 的实际导出表比对，找出 STATUS_ENTRYPOINT_NOT_FOUND 的根因。

v2: 新增传递依赖递归分析。当直接导入全部可解析时，自动深入每个
    DLL 的导入表查找间接缺失。

用法 (CI 环境):
    python scripts/diagnose_windows_imports.py [target/debug/deps/orbitx_lib-*.exe]

环境依赖:
    pip install pefile
"""

import ctypes
import ctypes.wintypes as w
import glob
import os
import sys
from collections import deque
from dataclasses import dataclass, field


# ── 类型声明 ──────────────────────────────────────────────────────────────────

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.LoadLibraryW.argtypes = [w.LPCWSTR]
kernel32.LoadLibraryW.restype = w.HMODULE
kernel32.GetProcAddress.argtypes = [w.HMODULE, w.LPCSTR]
kernel32.GetProcAddress.restype = w.LPVOID
kernel32.FreeLibrary.argtypes = [w.HMODULE]
kernel32.FreeLibrary.restype = w.BOOL
kernel32.GetLastError.argtypes = []
kernel32.GetLastError.restype = w.DWORD
kernel32.GetModuleFileNameW.argtypes = [w.HMODULE, w.LPWSTR, w.DWORD]
kernel32.GetModuleFileNameW.restype = w.DWORD


# ── 数据结构 ──────────────────────────────────────────────────────────────────

@dataclass
class ImportEntry:
    dll: str
    function: str
    ordinal: int | None = None


@dataclass
class MissingImport:
    entry: ImportEntry
    reason: str  # "function_not_found" | "dll_not_found" | "load_error"
    chain: list[str] = field(default_factory=list)  # 依赖链 e.g. ["orbitx.exe", "ole32.dll", "combase.dll"]


# ── 已检查函数缓存 ──────────────────────────────────────────────────────────

_checked_cache: dict[tuple[str, str], bool] = {}
_loaded_dll_paths: dict[str, str] = {}  # dll_name_lower → filesystem path


# ── 核心检查逻辑 ──────────────────────────────────────────────────────────────

def load_dll(dll_name: str) -> tuple[int | None, str]:
    """加载 DLL 并返回 (hmod, 实际路径)。"""
    hmod = kernel32.LoadLibraryW(dll_name)
    if not hmod:
        base = os.path.splitext(dll_name)[0]
        hmod = kernel32.LoadLibraryW(base)
    if not hmod:
        return None, ""

    buf = ctypes.create_unicode_buffer(260)
    n = kernel32.GetModuleFileNameW(hmod, buf, 260)
    path = buf.value if n else ""
    return hmod, path


def check_function_exists(dll_name: str, func_name: str) -> bool:
    """通过 LoadLibraryW + GetProcAddress 检查函数是否可在系统中解析。"""
    cache_key = (dll_name.lower(), func_name)
    if cache_key in _checked_cache:
        return _checked_cache[cache_key]

    hmod, path = load_dll(dll_name)
    if not hmod:
        _checked_cache[cache_key] = False
        return False

    func_bytes = func_name.encode("ascii", errors="replace")
    addr = kernel32.GetProcAddress(hmod, func_bytes)
    kernel32.FreeLibrary(hmod)
    result = addr is not None
    _checked_cache[cache_key] = result
    return result


def get_dll_path(dll_name: str) -> str | None:
    """获取已安装 DLL 的文件系统路径。"""
    lower = dll_name.lower()
    if lower in _loaded_dll_paths:
        return _loaded_dll_paths[lower]

    hmod, path = load_dll(dll_name)
    if hmod:
        kernel32.FreeLibrary(hmod)
        _loaded_dll_paths[lower] = path
        return path
    return None


# ── PE 解析 ────────────────────────────────────────────────────────────────────

def parse_imports(pe_path: str, quiet: bool = False) -> tuple[list[ImportEntry], set[str]]:
    """解析 PE 文件的导入表，返回 (导入项列表, 依赖 DLL 集合)。"""
    import pefile  # type: ignore

    pe = pefile.PE(pe_path, fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]]
    )

    imports: list[ImportEntry] = []
    dlls: set[str] = set()

    if not hasattr(pe, "DIRECTORY_ENTRY_IMPORT"):
        if not quiet:
            print("WARNING: 二进制文件没有导入表（可能是静态链接？）")
        return imports, dlls

    for entry in pe.DIRECTORY_ENTRY_IMPORT:
        dll_name = entry.dll.decode("utf-8") if entry.dll else "<unknown>"
        dlls.add(dll_name)
        for imp in entry.imports:
            name = (
                imp.name.decode("utf-8")
                if imp.name
                else f"#ordinal({imp.ordinal})"
            )
            imports.append(
                ImportEntry(
                    dll=dll_name,
                    function=name,
                    ordinal=imp.ordinal if imp.name is None else None,
                )
            )

    return imports, dlls


# ── 传递依赖递归分析 ─────────────────────────────────────────────────────────

# 已知系统 DLL 白名单——这些 DLL 总是可用的，不需要递归检查导入
_SYSTEM_DLL_WHITELIST: set[str] = {
    "ntdll.dll",
    "kernel32.dll",
    "kernelbase.dll",
    "user32.dll",
    "gdi32.dll",
    "advapi32.dll",
    "msvcrt.dll",
    "ucrtbase.dll",
    "bcryptprimitives.dll",
    "win32u.dll",
    "gdi32full.dll",
    "rpcrt4.dll",
    "sechost.dll",
    "wintypes.dll",
    "userenv.dll",
    "dwmapi.dll",
    "msvcp_win.dll",
    "shell32.dll",
    "ole32.dll",
    "oleaut32.dll",
    "combase.dll",
}

# 已知总是可用的 DLL 函数前缀（无需检查）
_KNOWN_PREFIXES = [
    "Nt", "Rtl", "Ldr", "Csr", "Dbg", "Ki", "Zw",  # ntdll
    "Create", "Close", "Read", "Write", "Get", "Set", "Open", "Delete",  # kernel32
    "Reg", "Crypt", "Event", "Wait", "Heap", "Virtual", "Map", "Load", "Free",
    "Initialize", "Unhandled", "Raise", "Terminate", "Exit", "Suspend", "Resume",
    "Query", "Flush", "Duplicate", "DeviceIo",
]


def _should_skip_check(dll_name: str, func_name: str) -> bool:
    """判断是否应跳过此函数的解析检查（已知系统函数）。"""
    lower_dll = dll_name.lower().removesuffix(".dll")
    if lower_dll in _SYSTEM_DLL_WHITELIST:
        return True
    for prefix in _KNOWN_PREFIXES:
        if func_name.startswith(prefix):
            return True
    return False


def analyze_transitive(
    root_binary: str,
    max_depth: int = 4,
    max_dlls: int = 100,
) -> list[MissingImport]:
    """递归分析传递依赖，返回缺失的函数列表（含依赖链）。

    算法:
    1. 解析 root_binary 的直接导入
    2. 对每个直接导入的 DLL，解析其自身导入表
    3. 递归进行直到 max_depth
    4. 在每个层级，检查函数是否在系统中可解析
    5. 跳过系统 DLL 白名单中的项以提高效率
    """
    import pefile  # type: ignore

    missing: list[MissingImport] = []
    visited_dlls: set[str] = set()  # 已解析导入表的 DLL（lowercase path）
    total_checked = 0

    # BFS 队列: (pe_path, chain)
    queue: deque[tuple[str, list[str]]] = deque()
    queue.append((root_binary, []))

    while queue:
        pe_path, chain = queue.popleft()

        # 深度限制
        if len(chain) >= max_depth:
            continue

        # 解析当前 PE 的导入表
        try:
            imports, dll_deps = parse_imports(pe_path, quiet=True)
        except Exception:
            continue

        # 对每个依赖 DLL
        for dll_name in sorted(dll_deps):
            lower_dll = dll_name.lower()

            # 跳过已访问的 DLL
            if lower_dll in visited_dlls:
                continue

            # 获取 DLL 路径
            dll_path = get_dll_path(dll_name)
            if not dll_path:
                # DLL 无法加载，检查是否是根本原因
                # 如果已经在 chain 中，说明是传递依赖失败
                new_chain = chain + [os.path.basename(pe_path)] if chain else [os.path.basename(pe_path)]
                missing.append(MissingImport(
                    ImportEntry(dll=dll_name, function="<DLL_LOAD_FAILED>"),
                    reason=f"DLL 无法加载 (可能缺失或无法访问)",
                    chain=new_chain,
                ))
                continue

            if lower_dll in visited_dlls:
                continue

            # 检查 DLL 是否可以解析（不在白名单中才检查导入）
            if lower_dll not in _SYSTEM_DLL_WHITELIST and dll_path not in visited_dlls:
                # 解析这个 DLL 的导入表
                try:
                    _, sub_deps = parse_imports(dll_path, quiet=True)
                except Exception:
                    sub_deps = set()

                # 检查这个 DLL 本身的导入是否可解析
                for sub_dll in sorted(sub_deps):
                    sub_lower = sub_dll.lower()
                    if sub_lower in _SYSTEM_DLL_WHITELIST:
                        continue

                    # 检查这个二级 DLL 是否可加载
                    sub_hmod, sub_path = load_dll(sub_dll)
                    if sub_hmod:
                        kernel32.FreeLibrary(sub_hmod)
                    else:
                        new_chain = chain + [os.path.basename(pe_path), dll_name]
                        missing.append(MissingImport(
                            ImportEntry(dll=sub_dll, function="<DLL_LOAD_FAILED>"),
                            reason=f"DLL 无法加载（{dll_name} 的依赖）",
                            chain=new_chain,
                        ))

                # 添加到 BFS 队列
                new_chain = chain + [os.path.basename(pe_path)] if chain else [os.path.basename(pe_path)]
                queue.append((dll_path, new_chain))

            visited_dlls.add(lower_dll)

            # 限制检查数量
            if len(visited_dlls) >= max_dlls:
                break

        if len(visited_dlls) >= max_dlls:
            break

    return missing


# ── 重点 DLL 列表（windows crate features 对应的已知 DLL） ────────────────────────

SUSPECT_DLLS: set[str] = {
    "uiautomationcore.dll",
    "ole32.dll",
    "oleaut32.dll",
    "user32.dll",
    "gdi32.dll",
    "shcore.dll",
    "kernel32.dll",
}


# ── 主逻辑 ────────────────────────────────────────────────────────────────────

def run(target_glob: str) -> int:
    """返回码：0 = 全部解析成功，1 = 发现缺失入口点，2 = 脚本错误。"""
    # 1. 定位测试二进制文件
    binaries = glob.glob(target_glob)
    if not binaries:
        print(f"ERROR: 未找到匹配 '{target_glob}' 的测试二进制文件")
        return 2

    binary = sorted(binaries, key=os.path.getmtime, reverse=True)[0]
    print(f"目标二进制文件: {binary}")
    print(f"文件大小: {os.path.getsize(binary):,} bytes\n")

    # 2. 解析直接导入表
    try:
        imports, direct_dlls = parse_imports(binary)
    except ImportError:
        print("ERROR: 需要 pefile 库。请执行: pip install pefile")
        return 2
    except Exception as e:
        print(f"ERROR: PE 解析失败: {e}")
        return 2

    # 3. 按 DLL 分组
    by_dll: dict[str, list[ImportEntry]] = {}
    for imp in imports:
        by_dll.setdefault(imp.dll, []).append(imp)

    print(f"导入表中共 {len(imports)} 个函数引用，来自 {len(by_dll)} 个 DLL")
    for dll_name in sorted(by_dll.keys()):
        print(f"  - {dll_name} ({len(by_dll[dll_name])} functions)")
        # 对导入较少的 DLL（1-5 函数），打印全部函数名方便定位
        if len(by_dll[dll_name]) <= 5:
            func_names = sorted(e.function for e in by_dll[dll_name])
            for fn in func_names:
                print(f"      -> {fn}")
    print()

    # 4. 逐函数检查直接导入
    missing: list[MissingImport] = []
    total_checked = 0

    for dll_name in sorted(by_dll.keys()):
        entries = by_dll[dll_name]

        # 先检查 DLL 是否可加载
        hmod, dll_path = load_dll(dll_name)
        if not hmod:
            for entry in entries:
                missing.append(MissingImport(entry, "DLL 无法加载"))
            print(f"  {dll_name}: SKIPPED - DLL 无法加载")
            continue
        kernel32.FreeLibrary(hmod)

        # 逐函数检查
        for entry in entries:
            total_checked += 1
            if check_function_exists(dll_name, entry.function):
                continue
            m = MissingImport(entry, "函数在 DLL 中不存在")
            missing.append(m)

        missing_in_dll = [m for m in missing if m.entry.dll == dll_name]
        if missing_in_dll:
            print(f"\n  [{dll_name}] {len(missing_in_dll)}/{len(entries)} 缺失:")
            for m in missing_in_dll:
                print(f"    MISSING: {m.entry.function}  ({m.reason})")

    # 5. 汇总直接导入结果
    print(f"\n{'=' * 60}")
    print(f"直接导入诊断完成: 共检查 {total_checked} 个导入函数")
    print(f"缺失入口点: {len(missing)}")
    print(f"{'=' * 60}")

    # 6. 如果直接导入全部解析，启动传递依赖分析
    transitive_missing: list[MissingImport] = []
    if not missing:
        print("\n直接导入全部可解析，开始传递依赖递归分析...")
        print("(检查每个 DLL 的导入表，递归寻找缺失的间接依赖)\n")

        transitive_missing = analyze_transitive(binary, max_depth=4, max_dlls=150)

        if transitive_missing:
            print(f"\n{'=' * 60}")
            print(f"传递依赖分析发现 {len(transitive_missing)} 个缺失:")
            print(f"{'=' * 60}")
            for m in transitive_missing:
                chain_str = " → ".join(m.chain) if m.chain else "(直接)"
                print(f"  链: {chain_str}")
                print(f"  缺失: {m.entry.dll}: {m.entry.function}")
                print(f"  原因: {m.reason}")
                print()
        else:
            print("\n传递依赖分析未发现缺失。")

    # 7. 汇总最终结论
    all_missing = missing + transitive_missing

    if all_missing:
        print(f"\n{'=' * 60}")
        print(f"最终结果: 发现 {len(all_missing)} 个缺失入口点")
        print(f"  直接缺失: {len(missing)}")
        print(f"  传递缺失: {len(transitive_missing)}")
        print(f"{'=' * 60}")

        if transitive_missing:
            print("\n这些传递缺失就是导致 STATUS_ENTRYPOINT_NOT_FOUND 的根因。")

    # 8. GitHub Actions 工作流摘要
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write("\n## Windows DLL 导入诊断 (含传递依赖分析)\n\n")
            fh.write(f"- 目标: `{os.path.basename(binary)}`\n")
            fh.write(f"- 直接导入函数: {total_checked} (全部可解析)\n" if not missing else f"- 直接缺失: {len(missing)}\n")
            fh.write(f"- 传递缺失: {len(transitive_missing)}\n")
            if transitive_missing:
                fh.write("\n### 关键: 传递依赖中的缺失入口点\n\n")
                fh.write("| 依赖链 | 缺失 DLL | 缺失函数 |\n")
                fh.write("| ------ | -------- | -------- |\n")
                for m in transitive_missing[:20]:
                    chain_str = " → ".join(m.chain)
                    fh.write(f"| `{chain_str}` | `{m.entry.dll}` | `{m.entry.function}` |\n")

    return 1 if all_missing else 0


if __name__ == "__main__":
    target = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "target/debug/deps/orbitx_lib-*.exe"
    )
    sys.exit(run(target))
