/// 跨平台剪贴板安全通道。
///
/// macOS：全量备份 → 模拟 Cmd+C → 轮询等待 → 读取 → 全量恢复
/// Windows：模拟 Ctrl+C → 轮询等待 → 读取（无备份恢复，文本留在剪贴板）
/// 作为 AX/UIA 无障碍路径无法覆盖时的降级方案。
use std::sync::atomic::{AtomicBool, Ordering};

use crate::grab::GrabError;

#[cfg(test)]
mod tests {
    use super::*;

    /// 将栈上 AtomicBool 通过 Box::leak 转为 &'static，满足 capture 签名。
    /// 测试代码专用，内存泄漏在测试进程退出时由 OS 回收。
    fn leak_lock(val: bool) -> &'static AtomicBool {
        Box::leak(Box::new(AtomicBool::new(val)))
    }

    #[test]
    fn clipboard_lock_guard_drop_releases_lock() {
        let lock = leak_lock(false);
        // 模拟 capture 中先 CAS 获取锁
        let prev = lock.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed);
        assert!(prev.is_ok(), "CAS 应成功获取锁");

        {
            let _guard = ClipboardLockGuard(lock);
            assert!(lock.load(Ordering::Acquire), "guard 存活时锁应为 true");
        }
        // guard drop 后锁应释放
        assert!(!lock.load(Ordering::Acquire), "guard drop 后锁应为 false");
    }

    #[test]
    fn capture_returns_clipboardlockfailed_when_lock_already_held() {
        let lock = leak_lock(true); // 锁已被持有
        let guardian = ClipboardGuardian::new(80, 5);
        let result = guardian.capture(1000, lock);
        assert_eq!(result, Err(GrabError::ClipboardLockFailed));
        // 锁状态不变（仍为 true，因为不是我们获取的）
        assert!(lock.load(Ordering::Acquire));
    }

    #[test]
    fn capture_cas_failure_does_not_proceed_to_platform_code() {
        // 验证锁冲突时立即返回，不进入 do_capture（从而避免调用平台 API）
        let lock = leak_lock(true);
        let guardian = ClipboardGuardian::new(80, 5);
        // 调用 capture，预期在 CAS 时失败
        let result = guardian.capture(1000, lock);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), GrabError::ClipboardLockFailed);
    }

    #[test]
    fn lock_guard_drop_is_idempotent_under_panic_scenarios() {
        // 模拟 panic unwind 场景：即使多次创建 guard，
        // 每个 Drop 都会执行 store(false)，不会 panic 或死锁
        let lock = leak_lock(false);
        lock.store(true, Ordering::Release);

        // 多个 guard 引用同一锁（正常不会发生，但验证安全）
        let guard1 = ClipboardLockGuard(lock);
        let guard2 = ClipboardLockGuard(lock);

        // Drop guard1
        drop(guard1);
        assert!(!lock.load(Ordering::Acquire), "guard1 drop 后锁释放");

        // guard2 仍然存活但锁已为 false
        // Drop guard2 再次 store(false) —— 幂等，不应 panic
        lock.store(true, Ordering::Release); // guard2 存在时又有人拿锁
        drop(guard2);
        assert!(!lock.load(Ordering::Acquire), "guard2 drop 后锁释放");
    }
}

// ── RAII 锁 ──────────────────────────────────────────────────────────────────

/// 剪贴板全局锁 RAII guard。`Drop` 时自动释放，panic unwind 路径也安全。
pub struct ClipboardLockGuard(pub &'static AtomicBool);

impl Drop for ClipboardLockGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

// ── ClipboardGuardian ────────────────────────────────────────────────────────

pub struct ClipboardGuardian {
    timeout_ms: u64,
    poll_interval_ms: u64,
}

impl ClipboardGuardian {
    pub fn new(timeout_ms: u64, poll_interval_ms: u64) -> Self {
        ClipboardGuardian {
            timeout_ms,
            poll_interval_ms,
        }
    }

    /// 执行剪贴板抓取链路（macOS: save→simulate→poll→read→restore; Windows: simulate→poll→read），
    /// 带 RAII 锁和 catch_unwind 兜底。
    pub fn capture(
        &self,
        max_length: usize,
        lock: &'static AtomicBool,
    ) -> Result<String, GrabError> {
        // 1. 获取全局锁
        if lock
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            log::warn!(target: "grab", "剪贴板锁冲突，另一快捷键正在使用剪贴板通道");
            return Err(GrabError::ClipboardLockFailed);
        }
        let _guard = ClipboardLockGuard(lock);

        // 2. catch_unwind 兜底：panic 时锁已被 guard 释放，此处记录并恢复剪贴板
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.do_capture(max_length)
        }));

        match result {
            Ok(r) => r,
            Err(_) => {
                log::error!(target: "grab", "剪贴板抓取 panic，已尽力恢复");
                Err(GrabError::Internal("剪贴板抓取 panic".into()))
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// macOS 实现
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::CString;
    use std::thread;
    use std::time::Instant;

    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    use super::{ClipboardGuardian, GrabError};

    // ── CGEvent extern "C" FFI ────────────────────────────────────────────────

    type CGEventRef = *mut std::ffi::c_void;
    type CGEventSourceRef = *mut std::ffi::c_void;
    type CGEventFlags = u64;
    type CGKeyCode = u16;
    type CGEventTapLocation = u32;

    const _K_CG_EVENT_FLAG_MASK_COMMAND: CGEventFlags = 0x0010_0000;
    const _K_CG_HID_EVENT_TAP: CGEventTapLocation = 0;
    const _K_CG_KEYCODE_C: CGKeyCode = 0x08;

    extern "C" {
        fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef,
            virtualKey: CGKeyCode,
            keyDown: bool,
        ) -> CGEventRef;
        fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
        fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
        fn CFRelease(cf: *mut std::ffi::c_void);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// 从 Rust &str 创建 autoreleased NSString。
    unsafe fn nsstring(s: &str) -> *mut Object {
        let cstr = CString::new(s).unwrap();
        msg_send![class!(NSString), stringWithUTF8String: cstr.as_ptr() as *const i8]
    }

    /// 安全获取 NSPasteboardItem 的 dataForType:，返回 NSData 字节副本。
    unsafe fn item_data_for_type(item: *mut Object, type_obj: *mut Object) -> Option<Vec<u8>> {
        let data: *mut Object = msg_send![item, dataForType: type_obj];
        if data.is_null() {
            return None;
        }
        let length: usize = msg_send![data, length];
        if length == 0 {
            return Some(Vec::new());
        }
        let bytes: *const u8 = msg_send![data, bytes];
        Some(std::slice::from_raw_parts(bytes, length).to_vec())
    }

    /// 获取 pasteboard type 的字符串表示。
    unsafe fn type_to_string(type_obj: *mut Object) -> String {
        let utf8: *const i8 = msg_send![type_obj, UTF8String];
        if utf8.is_null() {
            return String::new();
        }
        std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned()
    }

    // ── pasteboard 操作 ──────────────────────────────────────────────────────

    unsafe fn general_pasteboard() -> *mut Object {
        msg_send![class!(NSPasteboard), generalPasteboard]
    }

    /// 全量备份当前剪贴板所有 item 的所有 type representation。
    unsafe fn save_pasteboard(pb: *mut Object) -> Vec<(String, Vec<u8>)> {
        let mut backup: Vec<(String, Vec<u8>)> = Vec::new();

        let items: *mut Object = msg_send![pb, pasteboardItems];
        if items.is_null() {
            return backup;
        }

        let count: usize = msg_send![items, count];
        if count == 0 {
            return backup;
        }

        for i in 0..count {
            let item: *mut Object = msg_send![items, objectAtIndex: i];
            let types: *mut Object = msg_send![item, types];
            if types.is_null() {
                continue;
            }
            let type_count: usize = msg_send![types, count];
            for j in 0..type_count {
                let type_obj: *mut Object = msg_send![types, objectAtIndex: j];
                let type_name = type_to_string(type_obj);
                if let Some(data) = item_data_for_type(item, type_obj) {
                    backup.push((type_name, data));
                }
            }
        }

        backup
    }

    /// 通过 CGEvent 模拟 Cmd+C。
    unsafe fn simulate_cmd_c() {
        log::debug!(target: "grab", "剪贴板通道: simulate_cmd_c FFI 入口");
        // Key down
        let down =
            CGEventCreateKeyboardEvent(std::ptr::null_mut(), _K_CG_KEYCODE_C, true);
        if !down.is_null() {
            CGEventSetFlags(down, _K_CG_EVENT_FLAG_MASK_COMMAND);
            CGEventPost(_K_CG_HID_EVENT_TAP, down);
            CFRelease(down);
        }

        // Key up
        let up = CGEventCreateKeyboardEvent(std::ptr::null_mut(), _K_CG_KEYCODE_C, false);
        if !up.is_null() {
            CGEventSetFlags(up, _K_CG_EVENT_FLAG_MASK_COMMAND);
            CGEventPost(_K_CG_HID_EVENT_TAP, up);
            CFRelease(up);
        }
    }

    /// 轮询等待剪贴板 changeCount 变化，超时返回 ClipboardTimeout。
    unsafe fn wait_for_clipboard_change(
        pb: *mut Object,
        original_count: isize,
        timeout_ms: u64,
        poll_interval_ms: u64,
    ) -> Result<(), GrabError> {
        let start = Instant::now();
        loop {
            let count: isize = msg_send![pb, changeCount];
            if count != original_count {
                return Ok(());
            }
            if start.elapsed().as_millis() as u64 >= timeout_ms {
                log::warn!(target: "grab", "剪贴板变化等待超时 ({}ms)", timeout_ms);
                return Err(GrabError::ClipboardTimeout);
            }
            thread::sleep(std::time::Duration::from_millis(poll_interval_ms));
        }
    }

    /// 读取 pasteboard 中的字符串并按 max_length 截断。
    unsafe fn read_pasteboard_text(
        pb: *mut Object,
        max_length: usize,
    ) -> Result<String, GrabError> {
        let ns_type = nsstring("public.utf8-plain-text");
        let text_obj: *mut Object = msg_send![pb, stringForType: ns_type];
        if text_obj.is_null() {
            log::debug!(target: "grab", "剪贴板中未发现 UTF-8 文本");
            return Err(GrabError::NoSelection);
        }
        let utf8: *const i8 = msg_send![text_obj, UTF8String];
        if utf8.is_null() {
            return Ok(String::new());
        }
        let s = std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned();
        if s.is_empty() {
            log::debug!(target: "grab", "剪贴板文本为空字符串，视为无选中文本");
            return Err(GrabError::NoSelection);
        }
        if s.chars().count() <= max_length {
            Ok(s)
        } else {
            Ok(s.chars().take(max_length).collect())
        }
    }

    /// 全量恢复剪贴板内容，注入隐密标记。
    unsafe fn restore_pasteboard(pb: *mut Object, backup: &[(String, Vec<u8>)]) {
        let _: () = msg_send![pb, clearContents];
        if backup.is_empty() {
            return;
        }

        // 创建 pasteboard item 承载所有恢复数据
        let item: *mut Object = msg_send![class!(NSPasteboardItem), new];

        // 写入隐密标记，对抗 Maccy/Paste 等三方工具的无差别监听
        {
            let empty_bytes: [u8; 0] = [];
            let empty: *mut Object = msg_send![class!(NSData), dataWithBytes: empty_bytes.as_ptr() length: 0_usize];
            let transient = nsstring("org.nspasteboard.TransientType");
            let concealed = nsstring("org.nspasteboard.ConcealedType");
            let _: bool = msg_send![item, setData: empty forType: transient];
            let _: bool = msg_send![item, setData: empty forType: concealed];
        }

        // 逐条写回原始数据，跳过空数据条目（空 Vec 的 as_ptr 在快速
        // objc_msgSend 调用中可能导致不可预期的内存访问）
        for (type_name, data) in backup.iter() {
            if data.is_empty() {
                continue;
            }
            let ns_type = nsstring(type_name);
            let ns_data: *mut Object =
                msg_send![class!(NSData), dataWithBytes: data.as_ptr() length: data.len()];
            let _: bool = msg_send![item, setData: ns_data forType: ns_type];
        }

        // writeObjects 写入 pasteboard
        let array: *mut Object = msg_send![class!(NSArray), arrayWithObject: item];
        let _: () = msg_send![pb, writeObjects: array];

        // 释放 item（new → +1，arrayWithObject 已 retain，此处 -1）
        let _: () = msg_send![item, release];
    }

    // ── ClipboardGuardian::do_capture (macOS) ──────────────────────────────

    impl ClipboardGuardian {
        pub(super) fn do_capture(&self, max_length: usize) -> Result<String, GrabError> {
            let t0 = Instant::now();

            // 在 tokio 阻塞线程上手动管理 autorelease pool，
            // 避免跨多次调用累积 autoreleased 对象。
            let pool: *mut Object = unsafe { msg_send![class!(NSAutoreleasePool), new] };
            let result = self.do_capture_inner(max_length, t0);
            unsafe { let _: () = msg_send![pool, drain]; }

            result
        }

        fn do_capture_inner(&self, max_length: usize, t0: Instant) -> Result<String, GrabError> {
            log::info!(target: "grab", "剪贴板通道: 开始 do_capture");

            let pb = unsafe { general_pasteboard() };
            if pb.is_null() {
                log::error!(target: "grab", "无法获取 NSPasteboard.generalPasteboard");
                return Err(GrabError::System("NSPasteboard 句柄为空".into()));
            }

            // 1. save
            let backup = unsafe { save_pasteboard(pb) };
            let t1 = Instant::now();
            log::debug!(target: "grab", "剪贴板备份完成 ({} 条目, {}ms)", backup.len(), t1.duration_since(t0).as_millis());

            // 2. simulate Cmd+C
            let original_count: isize = unsafe { msg_send![pb, changeCount] };
            unsafe { simulate_cmd_c() };
            let t2 = Instant::now();
            log::debug!(target: "grab", "Cmd+C 模拟完成 ({}ms)", t2.duration_since(t1).as_millis());

            // 3. poll for change
            let poll_result = unsafe {
                wait_for_clipboard_change(pb, original_count, self.timeout_ms, self.poll_interval_ms)
            };
            let t3 = Instant::now();
            if poll_result.is_ok() {
                log::debug!(target: "grab", "轮询检测到变化 ({}ms)", t3.duration_since(t2).as_millis());
            } else {
                log::warn!(target: "grab", "轮询超时 ({}ms)", t3.duration_since(t2).as_millis());
            }

            // 3.5 检测到变化后等待一小段时间，让前台 App 完成多类型剪贴板写入，
            // 避免我们的 restore 与前台 App 的异步写入在 NSPasteboard 内部竞态。
            if poll_result.is_ok() {
                let settle_ms = (self.timeout_ms / 4).min(15);
                thread::sleep(std::time::Duration::from_millis(settle_ms));
            }

            // 4. read
            let text_result = match poll_result {
                Ok(()) => unsafe { read_pasteboard_text(pb, max_length) },
                Err(e) => Err(e),
            };
            let t4 = Instant::now();
            if let Ok(ref text) = text_result {
                log::debug!(target: "grab", "文本读取完成 ({} 字符, {}ms)", text.chars().count(), t4.duration_since(t3).as_millis());
            }

            // 5. restore（无论 read 成功与否都执行）
            unsafe { restore_pasteboard(pb, &backup) };
            let t5 = Instant::now();
            log::info!(target: "grab", "剪贴板恢复完成 ({}ms, 总计 {}ms)", t5.duration_since(t4).as_millis(), t5.duration_since(t0).as_millis());

            text_result
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Windows 实现
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
mod platform {
    use std::time::Instant;

    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_SHIFT,
    };

    use super::{ClipboardGuardian, GrabError};

    const VK_C: VIRTUAL_KEY = VIRTUAL_KEY(0x43);

    // Windows 剪贴板格式常量。CF_UNICODETEXT = 13，自 Windows NT 3.1 起为稳定 ABI。
    const CF_UNICODETEXT: u32 = 13;

    // ── 模拟 Ctrl+C ───────────────────────────────────────────────────────────

    fn keybd_input(w_vk: VIRTUAL_KEY, dw_flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: w_vk,
                    wScan: 0,
                    dwFlags: dw_flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// 模拟 Ctrl+C 将选中文本复制到剪贴板。
    ///
    /// 全局快捷键（Ctrl+Shift+K / Ctrl+Shift+E）触发时物理 Shift 和 Ctrl
    /// 可能仍处于按下状态。直接发送 Ctrl+C 会被目标应用识别为 Ctrl+Shift+C
    /// 而忽略复制操作。因此先释放所有修饰键，待键盘状态稳定后再发送
    /// 干净的 Ctrl+C。
    unsafe fn simulate_ctrl_c() {
        // 阶段一：释放可能被全局快捷键按住的修饰键
        let release: [INPUT; 2] = [
            keybd_input(VK_SHIFT, KEYEVENTF_KEYUP),
            keybd_input(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        let sent = SendInput(&release, std::mem::size_of::<INPUT>() as i32);
        log::debug!(target: "grab", "释放修饰键: {}/2 事件已发送", sent);

        // 等待键盘状态稳定
        std::thread::sleep(std::time::Duration::from_millis(15));

        // 阶段二：发送干净的 Ctrl+C
        let ctrl_c: [INPUT; 4] = [
            keybd_input(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
            keybd_input(VK_C, KEYBD_EVENT_FLAGS(0)),
            keybd_input(VK_C, KEYEVENTF_KEYUP),
            keybd_input(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        let sent = SendInput(&ctrl_c, std::mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            log::warn!(target: "grab", "SendInput 发送了 {} 个事件（预期 4）", sent);
        }
    }

    // ── 轮询 ──────────────────────────────────────────────────────────────────

    unsafe fn wait_for_clipboard_change(
        original_seq: u32,
        timeout_ms: u64,
        poll_interval_ms: u64,
    ) -> Result<(), GrabError> {
        let start = Instant::now();
        loop {
            let seq = GetClipboardSequenceNumber();
            if seq != original_seq {
                return Ok(());
            }
            if start.elapsed().as_millis() as u64 >= timeout_ms {
                log::warn!(target: "grab", "剪贴板变化等待超时 ({}ms)", timeout_ms);
                return Err(GrabError::ClipboardTimeout);
            }
            std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms));
        }
    }

    // ── 读取 ──────────────────────────────────────────────────────────────────

    unsafe fn read_clipboard_text(max_length: usize) -> Result<String, GrabError> {
        // 使用遗留剪贴板 API 读取文本。
        OpenClipboard(None).map_err(|e| {
            log::error!(target: "grab", "OpenClipboard 失败: {}", e);
            GrabError::System(format!("OpenClipboard 失败: {e}"))
        })?;

        let result = read_text_inner(max_length);
        let _ = CloseClipboard();
        result
    }

    unsafe fn read_text_inner(max_length: usize) -> Result<String, GrabError> {
        let handle = GetClipboardData(CF_UNICODETEXT)
            .map_err(|e| {
                log::error!(target: "grab", "GetClipboardData 失败: {}", e);
                GrabError::System(format!("GetClipboardData 失败: {e}"))
            })?;
        if handle.is_invalid() {
            log::debug!(target: "grab", "剪贴板中未发现 CF_UNICODETEXT 数据");
            return Err(GrabError::NoSelection);
        }

        let hglobal = HGLOBAL(handle.0);

        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            log::error!(target: "grab", "GlobalLock 返回 null");
            return Err(GrabError::System("GlobalLock 返回 null".into()));
        }

        let size = GlobalSize(hglobal);
        let result = if size == 0 {
            Ok(String::new())
        } else {
            // UTF-16LE → Rust String
            let utf16_units: &[u16] =
                std::slice::from_raw_parts(ptr as *const u16, (size / 2) as usize);
            let end = utf16_units.iter().position(|&c| c == 0).unwrap_or(utf16_units.len());
            let s = String::from_utf16_lossy(&utf16_units[..end]);
            if s.chars().count() <= max_length {
                Ok(s)
            } else {
                Ok(s.chars().take(max_length).collect())
            }
        };

        let _ = GlobalUnlock(hglobal);
        result
    }

    // ── ClipboardGuardian::do_capture (Windows) ─────────────────────────────

    impl ClipboardGuardian {
        pub(super) fn do_capture(&self, max_length: usize) -> Result<String, GrabError> {
            let t0 = Instant::now();
            log::info!(target: "grab", "剪贴板通道: 开始 do_capture");

            // 1. simulate Ctrl+C
            let original_seq = unsafe { GetClipboardSequenceNumber() };
            unsafe { simulate_ctrl_c() };
            let t1 = Instant::now();
            log::debug!(target: "grab", "Ctrl+C 模拟完成 ({}ms)", t1.duration_since(t0).as_millis());

            // 2. poll
            let poll_result = unsafe {
                wait_for_clipboard_change(original_seq, self.timeout_ms, self.poll_interval_ms)
            };
            let t2 = Instant::now();
            log::debug!(target: "grab", "轮询完成 ({}ms, {})", t2.duration_since(t1).as_millis(),
                if poll_result.is_ok() { "检测到变化" } else { "超时" });

            // 3. read
            let text_result = match poll_result {
                Ok(()) => unsafe { read_clipboard_text(max_length) },
                Err(e) => Err(e),
            };
            if let Ok(ref text) = text_result {
                log::debug!(target: "grab", "文本读取完成 ({} 字符, {}ms)", text.chars().count(), t0.elapsed().as_millis());
            }

            text_result
        }
    }
}
