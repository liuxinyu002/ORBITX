"""
Python 调试器：Caught STATUS_ENTRYPOINT_NOT_FOUND 的根因 DLL/函数。

使用 CreateProcess + DEBUG_PROCESS 从进程创建的第一条指令开始追踪，
捕获所有 LOAD_DLL / UNLOAD_DLL / EXCEPTION 调试事件。
当捕获到 0xc0000139 异常时，打印完整异常信息并列出所有已加载的 DLL。

用法 (CI 环境):
    python scripts/trace_loader_failure.py "target/debug/deps/orbitx_lib-*.exe"

不需要 CDB 或任何外部调试器。纯 Python + ctypes 实现。
不需要 pip 依赖（只使用标准库 ctypes）。
"""

import ctypes
import ctypes.wintypes as w
import glob
import os
import struct
import sys
from ctypes import POINTER, byref, sizeof, windll

# ── Windows API 声明 ──────────────────────────────────────────────────────

kernel32 = windll.kernel32
ntdll = windll.ntdll

# 常量
DEBUG_PROCESS = 0x00000001
DEBUG_ONLY_THIS_PROCESS = 0x00000002
CREATE_NEW_CONSOLE = 0x00000010
INFINITE = 0xFFFFFFFF

# 调试事件类型
EXCEPTION_DEBUG_EVENT = 1
CREATE_THREAD_DEBUG_EVENT = 2
CREATE_PROCESS_DEBUG_EVENT = 3
EXIT_THREAD_DEBUG_EVENT = 4
EXIT_PROCESS_DEBUG_EVENT = 5
LOAD_DLL_DEBUG_EVENT = 6
UNLOAD_DLL_DEBUG_EVENT = 7
OUTPUT_DEBUG_STRING_EVENT = 8
RIP_EVENT = 9

# 异常代码
STATUS_ENTRYPOINT_NOT_FOUND = 0xC0000139
STATUS_DLL_NOT_FOUND = 0xC0000135
STATUS_ACCESS_VIOLATION = 0xC0000005

# 异常标志
EXCEPTION_CONTINUE_EXECUTION = -1  # 0xFFFFFFFF
EXCEPTION_CONTINUE_SEARCH = 0
DBG_CONTINUE = 0x00010002
DBG_EXCEPTION_NOT_HANDLED = 0x80010001

# CreateProcess 结构体
class STARTUPINFOW(ctypes.Structure):
    _fields_ = [
        ("cb", w.DWORD),
        ("lpReserved", w.LPWSTR),
        ("lpDesktop", w.LPWSTR),
        ("lpTitle", w.LPWSTR),
        ("dwX", w.DWORD),
        ("dwY", w.DWORD),
        ("dwXSize", w.DWORD),
        ("dwYSize", w.DWORD),
        ("dwXCountChars", w.DWORD),
        ("dwYCountChars", w.DWORD),
        ("dwFillAttribute", w.DWORD),
        ("dwFlags", w.DWORD),
        ("wShowWindow", w.WORD),
        ("cbReserved2", w.WORD),
        ("lpReserved2", POINTER(ctypes.c_byte)),
        ("hStdInput", w.HANDLE),
        ("hStdOutput", w.HANDLE),
        ("hStdError", w.HANDLE),
    ]

class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("hProcess", w.HANDLE),
        ("hThread", w.HANDLE),
        ("dwProcessId", w.DWORD),
        ("dwThreadId", w.DWORD),
    ]

class EXCEPTION_RECORD(ctypes.Structure):
    pass

EXCEPTION_RECORD._fields_ = [
    ("ExceptionCode", w.DWORD),
    ("ExceptionFlags", w.DWORD),
    ("ExceptionRecord", POINTER(EXCEPTION_RECORD)),
    ("ExceptionAddress", w.LPVOID),
    ("NumberParameters", w.DWORD),
    ("ExceptionInformation", ctypes.c_ulonglong * 15),
]

class EXCEPTION_DEBUG_INFO(ctypes.Structure):
    _fields_ = [
        ("ExceptionRecord", EXCEPTION_RECORD),
        ("dwFirstChance", w.DWORD),
    ]

class CREATE_PROCESS_DEBUG_INFO(ctypes.Structure):
    _fields_ = [
        ("hFile", w.HANDLE),
        ("hProcess", w.HANDLE),
        ("hThread", w.HANDLE),
        ("lpBaseOfImage", w.LPVOID),
        ("dwDebugInfoFileOffset", w.DWORD),
        ("nDebugInfoSize", w.DWORD),
        ("lpThreadLocalBase", w.LPVOID),
        ("lpStartAddress", w.LPVOID),
        ("lpImageName", w.LPVOID),
        ("fUnicode", w.WORD),
    ]

class LOAD_DLL_DEBUG_INFO(ctypes.Structure):
    _fields_ = [
        ("hFile", w.HANDLE),
        ("lpBaseOfDll", w.LPVOID),
        ("dwDebugInfoFileOffset", w.DWORD),
        ("nDebugInfoSize", w.DWORD),
        ("lpImageName", w.LPVOID),
        ("fUnicode", w.WORD),
    ]

class EXIT_PROCESS_DEBUG_INFO(ctypes.Structure):
    _fields_ = [
        ("dwExitCode", w.DWORD),
    ]

class UNLOAD_DLL_DEBUG_INFO(ctypes.Structure):
    _fields_ = [
        ("lpBaseOfDll", w.LPVOID),
    ]

class OUTPUT_DEBUG_STRING_INFO(ctypes.Structure):
    _fields_ = [
        ("lpDebugStringData", w.LPCSTR),
        ("fUnicode", w.WORD),
        ("nDebugStringLength", w.WORD),
    ]

class DEBUG_EVENT_U(ctypes.Union):
    _fields_ = [
        ("Exception", EXCEPTION_DEBUG_INFO),
        ("CreateProcessInfo", CREATE_PROCESS_DEBUG_INFO),
        ("CreateThread", ctypes.c_byte * 100),
        ("ExitProcess", EXIT_PROCESS_DEBUG_INFO),
        ("ExitThread", ctypes.c_byte * 100),
        ("LoadDll", LOAD_DLL_DEBUG_INFO),
        ("UnloadDll", UNLOAD_DLL_DEBUG_INFO),
        ("DebugString", OUTPUT_DEBUG_STRING_INFO),
    ]

class DEBUG_EVENT(ctypes.Structure):
    _fields_ = [
        ("dwDebugEventCode", w.DWORD),
        ("dwProcessId", w.DWORD),
        ("dwThreadId", w.DWORD),
        ("u", DEBUG_EVENT_U),
    ]

# ── API 函数签名 ─────────────────────────────────────────────────────────

kernel32.CreateProcessW.argtypes = [
    w.LPCWSTR, w.LPWSTR, w.LPVOID, w.LPVOID,
    w.BOOL, w.DWORD, w.LPVOID, w.LPCWSTR,
    POINTER(STARTUPINFOW), POINTER(PROCESS_INFORMATION),
]
kernel32.CreateProcessW.restype = w.BOOL

kernel32.WaitForDebugEvent.restype = w.BOOL
kernel32.WaitForDebugEvent.argtypes = [POINTER(DEBUG_EVENT), w.DWORD]

kernel32.ContinueDebugEvent.restype = w.BOOL
kernel32.ContinueDebugEvent.argtypes = [w.DWORD, w.DWORD, w.DWORD]

kernel32.CloseHandle.restype = w.BOOL
kernel32.CloseHandle.argtypes = [w.HANDLE]

kernel32.GetLastError.argtypes = []
kernel32.GetLastError.restype = w.DWORD

kernel32.GetModuleFileNameW.argtypes = [w.HMODULE, w.LPWSTR, w.DWORD]
kernel32.GetModuleFileNameW.restype = w.DWORD


# ── 辅助函数 ──────────────────────────────────────────────────────────────

def get_module_path(hmod: int) -> str:
    """获取已加载模块的文件路径。"""
    if not hmod:
        return "(unknown)"
    buf = ctypes.create_unicode_buffer(512)
    n = kernel32.GetModuleFileNameW(hmod, buf, 512)
    if n:
        return buf.value
    return "(unknown)"


def read_process_memory_str(hProcess, addr, max_len=512) -> str | None:
    """从被调试进程的内存中读取以 null 结尾的字符串（Unicode）。"""
    if not addr:
        return None
    buf = ctypes.create_unicode_buffer(max_len)
    nread = ctypes.c_size_t(0)
    ok = kernel32.ReadProcessMemory(
        w.HANDLE(hProcess),
        w.LPCVOID(addr),
        buf,
        max_len * 2,  # Unicode = 2 bytes/char
        byref(nread),
    )
    if ok and nread.value > 0:
        return buf.value[: nread.value // 2]
    return None


# ── 调试循环 ──────────────────────────────────────────────────────────────

def extract_dll_name(load_dll_info: LOAD_DLL_DEBUG_INFO, hProcess) -> str:
    """尝试提取 DLL 名称（优先级：内存字符串 > base addr 显示）。"""
    # 首先尝试 lpImageName（仅当 fUnicode=1 且指针非空）
    if load_dll_info.lpImageName and load_dll_info.fUnicode:
        name = read_process_memory_str(hProcess, load_dll_info.lpImageName)
        if name:
            return name

    # 回退：显示基地址以便交叉引用 CDB 输出
    if load_dll_info.lpBaseOfDll:
        return f"<0x{load_dll_info.lpBaseOfDll:016X}>"

    return "<unknown DLL>"


def run_debugger(target_exe: str) -> int:
    """
    以调试器身份启动目标进程，追踪所有调试事件。
    返回 0 表示未发现入口点缺失，1 表示发现。
    """
    print(f"Target file: {target_exe}")
    print()

    si = STARTUPINFOW()
    si.cb = sizeof(STARTUPINFOW)
    pi = PROCESS_INFORMATION()

    # 使用 DEBUG_ONLY_THIS_PROCESS 避免调试子进程
    ok = kernel32.CreateProcessW(
        target_exe,      # lpApplicationName
        None,             # lpCommandLine (use exe path)
        None,             # lpProcessAttributes
        None,             # lpThreadAttributes
        False,            # bInheritHandles
        DEBUG_ONLY_THIS_PROCESS,
        None,             # lpEnvironment
        None,             # lpCurrentDirectory
        byref(si),
        byref(pi),
    )

    if not ok:
        err = kernel32.GetLastError()
        print(f"ERROR: CreateProcess failed (GLE={err})")
        return 2

    # 只关闭线程句柄（进程句柄在调试循环中需要用于 ReadProcessMemory）
    kernel32.CloseHandle(pi.hThread)

    hProcess = pi.hProcess
    process_id = pi.dwProcessId

    loaded_modules: dict[int, str] = {}  # base_addr → path
    module_load_order: list[str] = []    # 加载顺序
    entrypoint_found = False
    first_chance_seen = False

    print(f"Process created: PID={process_id}")
    print("Tracing DLL load and exception events...")
    print()

    dbg_event = DEBUG_EVENT()
    cont_status = DBG_CONTINUE

    while True:
        ok = kernel32.WaitForDebugEvent(byref(dbg_event), INFINITE)
        if not ok:
            break

        event_code = dbg_event.dwDebugEventCode

        if event_code == LOAD_DLL_DEBUG_EVENT:
            dll_info = dbg_event.u.LoadDll
            dll_path = extract_dll_name(dll_info, hProcess)
            base = dll_info.lpBaseOfDll
            loaded_modules[base] = dll_path
            module_load_order.append(dll_path)
            # 只在首次加载时打印（减少输出量）
            print(f"  [LOAD] {os.path.basename(dll_path)}")

        elif event_code == UNLOAD_DLL_DEBUG_EVENT:
            unload_info = dbg_event.u.UnloadDll
            base = unload_info.lpBaseOfDll
            if base in loaded_modules:
                name = os.path.basename(loaded_modules[base])
                print(f"  [UNLOAD] {name}")

        elif event_code == EXCEPTION_DEBUG_EVENT:
            exc = dbg_event.u.Exception
            code = exc.ExceptionRecord.ExceptionCode
            first_chance = exc.dwFirstChance != 0

            if first_chance:
                first_chance_seen = True

            # 检查是否是 c0000139 (STATUS_ENTRYPOINT_NOT_FOUND)
            if code == STATUS_ENTRYPOINT_NOT_FOUND:
                entrypoint_found = True
                # 使用 try-except 确保异常信息总能输出
                try:
                    print()
                    print(f"{'=' * 60}")
                    print(f"!!! Caught STATUS_ENTRYPOINT_NOT_FOUND (0x{STATUS_ENTRYPOINT_NOT_FOUND:08X}) !!!")
                    print(f"    First chance: {first_chance}")
                    print()
                    print(f"    Exception addr: 0x{exc.ExceptionRecord.ExceptionAddress:016X}")
                    print(f"    Exception param count: {exc.ExceptionRecord.NumberParameters}")
                    for i in range(min(3, exc.ExceptionRecord.NumberParameters)):
                        print(f"    ExceptionInformation[{i}]: 0x{exc.ExceptionRecord.ExceptionInformation[i]:016X}")
                    print()
                    print(f"    Currently loaded DLLs (load order):")
                    for i, name in enumerate(module_load_order):
                        print(f"      [{i:3d}] {os.path.basename(name)}")
                    print()
                    if module_load_order:
                        last = module_load_order[-1]
                        print(f"    Last successfully loaded DLL: {os.path.basename(last)}")
                        print(f"    (Load failure occurred during dependency resolution after this DLL)")
                    print(f"{'=' * 60}")
                except Exception as e:
                    # 如果格式化失败，至少输出基本信息
                    print(f"ERROR formatting exception info: {e}")
                    print(f"Exception code: 0x{code:08X}, first_chance={first_chance}")
                    print(f"Loaded modules: {[os.path.basename(n) for n in module_load_order]}")
                cont_status = DBG_EXCEPTION_NOT_HANDLED

            elif code == STATUS_DLL_NOT_FOUND:
                print()
                print(f"!!! Caught STATUS_DLL_NOT_FOUND (0x{code:08X}) !!!")
                print(f"    First chance: {first_chance}")
                if module_load_order:
                    print(f"    Last loaded: {os.path.basename(module_load_order[-1])}")

            elif code == STATUS_ACCESS_VIOLATION:
                print(f"  [EXCEPTION] ACCESS_VIOLATION @ 0x{exc.ExceptionRecord.ExceptionAddress:016X}")

            else:
                # 打印未知异常（可能包含额外信息）
                exc_name = f"0x{code:08X}"
                print(f"  [EXCEPTION] {exc_name} (first_chance={first_chance}) @ 0x{exc.ExceptionRecord.ExceptionAddress:016X}")

        elif event_code == EXIT_PROCESS_DEBUG_EVENT:
            exit_info = dbg_event.u.ExitProcess
            exit_code = exit_info.dwExitCode
            print(f"\nProcess exited: PID={dbg_event.dwProcessId}, ExitCode=0x{exit_code:08X}")

            if exit_code == STATUS_ENTRYPOINT_NOT_FOUND:
                print("Confirmed: process terminated due to STATUS_ENTRYPOINT_NOT_FOUND")
            break

        elif event_code == CREATE_PROCESS_DEBUG_EVENT:
            # 初始进程创建事件
            pass

        # 继续调试
        kernel32.ContinueDebugEvent(
            dbg_event.dwProcessId,
            dbg_event.dwThreadId,
            cont_status,
        )
        cont_status = DBG_CONTINUE

    kernel32.CloseHandle(hProcess)
    return 1 if entrypoint_found else 0


# ── 主逻辑 ────────────────────────────────────────────────────────────────

def main():
    target_glob = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "target/debug/deps/orbitx_lib-*.exe"
    )

    binaries = glob.glob(target_glob)
    if not binaries:
        print(f"ERROR: No match found for '{target_glob}' test binary")
        sys.exit(2)

    binary = sorted(binaries, key=os.path.getmtime, reverse=True)[0]
    result = run_debugger(binary)

    # 写入 GitHub Step Summary
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write("\n## Python Debugger Trace Results\n\n")
            if result == 1:
                fh.write("- Successfully caught STATUS_ENTRYPOINT_NOT_FOUND\n")
                fh.write("- See log above for last loaded DLL and exception params\n")
            elif result == 0:
                fh.write("- STATUS_ENTRYPOINT_NOT_FOUND not detected\n")
            else:
                fh.write("- Debugger startup failed\n")

    sys.exit(result)


if __name__ == "__main__":
    main()
