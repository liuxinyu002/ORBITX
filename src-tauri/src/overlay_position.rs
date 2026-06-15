/// Overlay 窗口光标定位与智能翻转。

// ══════════════════════════════════════════════════════════════════════════════
// 平台无关：纯函数 `compute_overlay_position`
// ══════════════════════════════════════════════════════════════════════════════

/// 根据光标位置和屏幕/窗口尺寸计算 overlay 定位坐标。
///
/// 返回 (x, y) 以屏幕左上角为原点。
/// - `spacing`: 窗口与光标之间的视觉间距
/// - `flip_threshold`: 光标距屏幕底部不足此值时翻转到上方
/// - 水平方向 clamp 到屏幕边界内
pub fn compute_overlay_position(
    cursor_x: f64,
    cursor_y: f64,
    screen_width: f64,
    screen_height: f64,
    window_width: f64,
    window_height: f64,
    spacing: f64,
    flip_threshold: f64,
) -> (f64, f64) {
    let x_offset = window_width / 2.0;

    // Y: 下方优先，空间不足则翻转到上方
    let y = if cursor_y + flip_threshold < screen_height {
        cursor_y + spacing
    } else {
        cursor_y - window_height - spacing
    };

    // X: 窗口中心对齐光标，然后 clamp 到屏幕边界
    let mut x = cursor_x - x_offset;
    if x < 0.0 {
        x = 0.0;
    } else if x + window_width > screen_width {
        x = screen_width - window_width;
    }

    (x, y)
}

// ══════════════════════════════════════════════════════════════════════════════
// macOS 平台实现
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "macos")]
mod platform {
    use objc::{class, msg_send, sel, sel_impl, Encode, Encoding};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSPoint {
        x: f64,
        y: f64,
    }

    unsafe impl Encode for NSPoint {
        fn encode() -> Encoding {
            unsafe { Encoding::from_str("{CGPoint=dd}") }
        }
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSSize {
        width: f64,
        height: f64,
    }

    unsafe impl Encode for NSSize {
        fn encode() -> Encoding {
            unsafe { Encoding::from_str("{CGSize=dd}") }
        }
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSRect {
        origin: NSPoint,
        size: NSSize,
    }

    unsafe impl Encode for NSRect {
        fn encode() -> Encoding {
            unsafe { Encoding::from_str("{CGRect={CGPoint=dd}{CGSize=dd}}") }
        }
    }

    /// macOS: 获取全局鼠标光标位置（屏幕坐标系，原点左上角）。
    pub fn get_cursor_position() -> Result<(f64, f64), String> {
        unsafe {
            let cls = class!(NSEvent);
            let point: NSPoint = msg_send![cls, mouseLocation];
            // NSEvent.mouseLocation 原点在左下角，需翻转到左上角
            let screen_cls = class!(NSScreen);
            let screen: *mut objc::runtime::Object = msg_send![screen_cls, mainScreen];
            if screen.is_null() {
                return Err("无法获取主屏幕".into());
            }
            let frame: NSRect = msg_send![screen, frame];
            let screen_h = frame.size.height;
            Ok((point.x, screen_h - point.y))
        }
    }

    /// macOS: 获取主屏幕尺寸（宽, 高）。
    pub fn get_screen_size() -> Result<(f64, f64), String> {
        unsafe {
            let screen_cls = class!(NSScreen);
            let screen: *mut objc::runtime::Object = msg_send![screen_cls, mainScreen];
            if screen.is_null() {
                return Err("无法获取主屏幕".into());
            }
            let frame: NSRect = msg_send![screen, frame];
            Ok((frame.size.width, frame.size.height))
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Windows 平台实现
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
mod platform {
    use windows::Win32::Graphics::Gdi::{GetDpiForMonitor, GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    use windows::Win32::Foundation::{POINT, RECT};

    /// Windows: 获取全局鼠标光标位置（屏幕坐标系，原点左上角）。
    /// 将 GetCursorPos 返回的物理像素转换为逻辑像素，与 get_screen_size()
    /// 返回的逻辑像素坐标系一致。
    pub fn get_cursor_position() -> Result<(f64, f64), String> {
        unsafe {
            let mut pt = POINT::default();
            GetCursorPos(&mut pt)
                .map_err(|e| format!("GetCursorPos 失败: {e:?}"))?;
            let (px, py) = (pt.x as f64, pt.y as f64);

            // 获取光标所在 monitor 的 DPI，将物理像素转为逻辑像素
            let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
            if monitor.is_invalid() {
                return Err("MonitorFromPoint 返回无效句柄".into());
            }
            let mut dpi_x: u32 = 96;
            let mut dpi_y: u32 = 96;
            let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
            let lx = px * 96.0 / dpi_x as f64;
            let ly = py * 96.0 / dpi_y as f64;

            log::debug!(target: "overlay", "坐标转换 physical=({},{}), dpi=({},{}), logical=({},{})", px, py, dpi_x, dpi_y, lx, ly);
            Ok((lx, ly))
        }
    }

    /// Windows: 获取光标所在显示器的尺寸（宽, 高）。
    pub fn get_screen_size() -> Result<(f64, f64), String> {
        unsafe {
            let cursor_pos = get_cursor_position()?;
            let pt = POINT {
                x: cursor_pos.0 as i32,
                y: cursor_pos.1 as i32,
            };
            let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
            if monitor.is_invalid() {
                return Err("MonitorFromPoint 返回无效句柄".into());
            }
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(monitor, &mut info)
                .ok()
                .map_err(|e| format!("GetMonitorInfoW 失败: {e:?}"))?;
            let rc: RECT = info.rcMonitor;
            Ok(((rc.right - rc.left) as f64, (rc.bottom - rc.top) as f64))
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// 公共导出
// ══════════════════════════════════════════════════════════════════════════════

pub use platform::{get_cursor_position, get_screen_size};

// ══════════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::compute_overlay_position;

    /// 下方有足够空间：窗口应放在光标下方 20px，水平居中。
    #[test]
    fn below_cursor_when_room_exists() {
        // 光标 (500, 200)，窗口 480×48，屏幕 1920×1080，margin 20
        let (x, y) = compute_overlay_position(500.0, 200.0, 1920.0, 1080.0, 480.0, 48.0, 20.0, 128.0);
        // x: 500 - 240 = 260
        assert_eq!(x, 260.0);
        // y: 200 + 20 = 220
        assert_eq!(y, 220.0);
    }

    /// 下方空间不足时应翻转到光标上方。
    #[test]
    fn flip_above_when_no_room_below() {
        // 光标 (500, 1040)，窗口 480×48，屏幕 1920×1080，margin 20
        // cursor_y(1040) + flip_threshold(48+20=68) = 1108 > screen_h(1080)
        let (x, y) = compute_overlay_position(500.0, 1040.0, 1920.0, 1080.0, 480.0, 48.0, 20.0, 128.0);
        // x: 500 - 240 = 260
        assert_eq!(x, 260.0);
        // y: 1040 - 48 - 20 = 972
        assert_eq!(y, 972.0);
    }

    /// 翻转阈值边界：恰好等于屏幕高度时触发翻转。
    #[test]
    fn flip_when_exactly_at_threshold() {
        // cursor_y(952) + flip_threshold(128) = 1080 == screen_h(1080) → 翻转（< 条件）
        let (_, y) = compute_overlay_position(500.0, 952.0, 1920.0, 1080.0, 480.0, 48.0, 20.0, 128.0);
        // y: 952 - 48 - 20 = 884
        assert_eq!(y, 884.0);
    }

    /// 光标在左边缘时 clamp 到 0。
    #[test]
    fn clamp_left_boundary() {
        // 光标 (100, 200)，x - 240 = -140 → clamp 到 0
        let (x, _) = compute_overlay_position(100.0, 200.0, 1920.0, 1080.0, 480.0, 48.0, 20.0, 128.0);
        assert_eq!(x, 0.0);
    }

    /// 光标在右边缘时 clamp 到 screen_width - window_width。
    #[test]
    fn clamp_right_boundary() {
        // 光标 (1800, 200)，x - 240 = 1560，x + 480 = 2040 > 1920 → clamp
        let (x, _) = compute_overlay_position(1800.0, 200.0, 1920.0, 1080.0, 480.0, 48.0, 20.0, 128.0);
        assert_eq!(x, 1440.0); // 1920 - 480
    }

    /// 小屏幕场景：光标在右下角时同时触发翻转和右边界 clamp。
    #[test]
    fn small_screen_flip_and_clamp() {
        // 小屏幕 1024×768，窗口 480×48，光标在右下角 (900, 700)
        // cursor_y(700) + flip_threshold(128) = 828 > screen_h(768) → 翻转
        // cursor_x(900) - 240 = 660, 660 + 480 = 1140 > 1024 → clamp
        let (x, y) = compute_overlay_position(900.0, 700.0, 1024.0, 768.0, 480.0, 48.0, 20.0, 128.0);
        assert_eq!(x, 544.0); // 1024 - 480
        assert_eq!(y, 632.0); // 700 - 48 - 20
    }
}
