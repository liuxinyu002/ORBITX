"""
Windows PE 导入表诊断工具。

解析 cargo test --lib 生成的测试二进制文件的导入表，
逐函数与系统 DLL 的实际导出表比对，找出 STATUS_ENTRYPOINT_NOT_FOUND 的根因。

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


# ── 核心检查逻辑 ──────────────────────────────────────────────────────────────

def check_function_exists(dll_name: str, func_name: str) -> bool:
    """通过 LoadLibraryW + GetProcAddress 检查函数是否可在系统中解析。"""
    hmod = kernel32.LoadLibraryW(dll_name)
    if not hmod:
        # 可能是 API set 重定向，尝试不带 .dll 后缀
        base = os.path.splitext(dll_name)[0]
        hmod = kernel32.LoadLibraryW(base)
    if not hmod:
        return False

    func_bytes = func_name.encode("ascii", errors="replace")
    addr = kernel32.GetProcAddress(hmod, func_bytes)
    kernel32.FreeLibrary(hmod)
    return addr is not None


def check_dll_loadable(dll_name: str) -> tuple[bool, str]:
    """返回 (是否可加载, 错误信息)。"""
    hmod = kernel32.LoadLibraryW(dll_name)
    if hmod:
        kernel32.FreeLibrary(hmod)
        return True, ""
    base = os.path.splitext(dll_name)[0]
    hmod2 = kernel32.LoadLibraryW(base)
    if hmod2:
        kernel32.FreeLibrary(hmod2)
        return True, ""
    err = kernel32.GetLastError()
    return False, f"LoadLibrary 失败 (GetLastError={err})"


# ── PE 解析 ────────────────────────────────────────────────────────────────────

def parse_imports(pe_path: str) -> list[ImportEntry]:
    """解析 PE 文件的导入表，返回所有导入项的扁平列表。"""
    import pefile  # type: ignore

    pe = pefile.PE(pe_path, fast_load=True)
    # 必须解析导入表
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]]
    )

    imports: list[ImportEntry] = []

    if not hasattr(pe, "DIRECTORY_ENTRY_IMPORT"):
        print("WARNING: 二进制文件没有导入表（可能是静态链接？）")
        return imports

    for entry in pe.DIRECTORY_ENTRY_IMPORT:
        dll_name = entry.dll.decode("utf-8") if entry.dll else "<unknown>"
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

    return imports


# ── 重点 DLL 列表（windows crate features 对应的已知 DLL） ────────────────────────

# 这些是 windows crate Cargo.toml features 引用的 DLL。
# 如果其中任何函数缺失，就是 STATUS_ENTRYPOINT_NOT_FOUND 的根因。
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

    # 取最新（如果匹配多个）
    binary = sorted(binaries, key=os.path.getmtime, reverse=True)[0]
    print(f"目标二进制文件: {binary}")
    print(f"文件大小: {os.path.getsize(binary):,} bytes\n")

    # 2. 解析导入表
    try:
        imports = parse_imports(binary)
    except ImportError:
        print("ERROR: 需要 pefile 库。请执行: pip install pefile")
        return 2
    except Exception as e:
        print(f"ERROR: PE 解析失败: {e}")
        return 2

    print(f"导入表中共 {len(imports)} 个函数引用\n")

    # 3. 按 DLL 分组
    by_dll: dict[str, list[ImportEntry]] = {}
    for imp in imports:
        by_dll.setdefault(imp.dll, []).append(imp)

    # 4. 逐函数检查
    missing: list[MissingImport] = []
    suspect_missing: list[MissingImport] = []
    total_checked = 0

    for dll_name in sorted(by_dll.keys()):
        entries = by_dll[dll_name]
        is_suspect = dll_name.lower() in SUSPECT_DLLS

        # 先检查 DLL 是否可加载
        loadable, load_err = check_dll_loadable(dll_name)
        if not loadable:
            for entry in entries:
                m = MissingImport(entry, f"DLL 无法加载: {load_err}")
                missing.append(m)
                if is_suspect:
                    suspect_missing.append(m)
            print(f"  {dll_name}: SKIPPED - DLL 无法加载 ({load_err})")
            continue

        # 逐函数检查
        for entry in entries:
            total_checked += 1
            if not check_function_exists(dll_name, entry.function):
                m = MissingImport(entry, "函数在 DLL 中不存在")
                missing.append(m)
                if is_suspect:
                    suspect_missing.append(m)

        missing_in_dll = [m for m in missing if m.entry.dll == dll_name]
        if missing_in_dll:
            print(f"\n  [{dll_name}] {len(missing_in_dll)}/{len(entries)} 缺失:")
            for m in missing_in_dll:
                print(f"    MISSING: {m.entry.function}  ({m.reason})")
        else:
            pass  # 全部通过时不打印，保持输出简洁

    # 5. 汇总报告
    print(f"\n{'=' * 60}")
    print(f"诊断完成: 共检查 {total_checked} 个导入函数")
    print(f"缺失入口点: {len(missing)}")
    print(f"其中来自 windows crate 相关 DLL 的缺失: {len(suspect_missing)}")
    print(f"{'=' * 60}")

    if suspect_missing:
        print("\n=== 关键发现: windows crate 相关 DLL 中的缺失函数 ===")
        for m in suspect_missing:
            print(f"  {m.entry.dll}: {m.entry.function}")
        print("\n这些就是导致 STATUS_ENTRYPOINT_NOT_FOUND 的根因。")

    if missing and not suspect_missing:
        print("\n=== 缺失的函数（非 windows crate 相关 DLL）===")
        for m in missing:
            print(f"  {m.entry.dll}: {m.entry.function}")

    # 6. GitHub Actions 工作流摘要（如果 $GITHUB_STEP_SUMMARY 存在则写入）
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a") as fh:
            fh.write("\n## Windows DLL 导入诊断\n\n")
            fh.write(f"- 目标: `{os.path.basename(binary)}`\n")
            fh.write(f"- 总导入函数: {total_checked}\n")
            fh.write(f"- 缺失入口点: {len(missing)}\n")
            if suspect_missing:
                fh.write("\n### 关键: windows crate 相关缺失\n\n")
                fh.write("| DLL | 缺失函数 |\n")
                fh.write("| --- | -------- |\n")
                for m in suspect_missing:
                    fh.write(f"| `{m.entry.dll}` | `{m.entry.function}` |\n")

    return 1 if missing else 0


if __name__ == "__main__":
    target = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "target/debug/deps/orbitx_lib-*.exe"
    )
    sys.exit(run(target))
