use log;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
/// 托盘菜单中需要运行时更新的 MenuItem 引用。
pub struct TrayMenuRefs {
    pub silent_extract_item: MenuItem<tauri::Wry>,
    pub current_task_item: MenuItem<tauri::Wry>,
}

/// 构建完整的 7 项系统托盘菜单及事件处理。
///
/// 交互模型：
///   - 左键单击托盘图标 → 显示/聚焦主窗口
///   - 右键单击托盘图标 → 弹出菜单（7 项）
///
/// 菜单拓扑：
///   1. 显示主窗口        (启用)
///   2. 全局设置          (禁用 — Phase-2)
///   3. 静默提取: 已就绪   (禁用 — Phase-5)
///   4. 当前任务: 无      (禁用 — Phase-5)
///   --- (分隔线)
///   5. 关于 OrbitX       (启用)
///   6. 退出              (启用)
pub fn build_tray(app: &AppHandle) -> Result<TrayMenuRefs, Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "全局设置")
        .enabled(false)
        .build(app)?;
    let silent = MenuItemBuilder::with_id("silent_extract", "静默提取: 已就绪")
        .enabled(false)
        .build(app)?;
    let current = MenuItemBuilder::with_id("current_task", "当前任务: 无")
        .enabled(false)
        .build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let about = MenuItemBuilder::with_id("about", "关于 OrbitX").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &settings, &silent, &current, &separator, &about, &quit])
        .build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("未找到窗口图标资源");

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("OrbitX")
        .menu(&menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                log::info!("托盘左键单击，显示主窗口");
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    log::info!(
                        "主窗口状态 — visible: {:?}, minimized: {:?}",
                        window.is_visible(),
                        window.is_minimized()
                    );
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    log::info!("窗口恢复操作已完成");
                } else {
                    log::warn!("未找到主窗口");
                }
            }
        })
        .on_menu_event(|app_handle, event| {
            match event.id().as_ref() {
                "show" => {
                    log::info!("托盘菜单: 显示主窗口");
                    if let Some(window) = app_handle.get_webview_window("main") {
                        log::info!(
                            "主窗口状态 — visible: {:?}, minimized: {:?}",
                            window.is_visible(),
                            window.is_minimized()
                        );
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        log::info!("窗口恢复操作已完成");
                    } else {
                        log::warn!("未找到主窗口");
                    }
                }
                "about" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.eval(
                            "alert('OrbitX v0.1.0\\n\\n跨平台桌面数据提取工具箱\\n\\nCopyright 2026')",
                        );
                    }
                }
                "quit" => {
                    log::info!("用户通过托盘菜单请求退出");
                    if let Some(state) = app_handle.try_state::<crate::db::state::DbState>() {
                        if let Ok(conn) = state.conn.lock() {
                            log::info!("正在执行 WAL checkpoint");
                            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
                            log::info!("WAL checkpoint 已完成");
                        }
                    }
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    log::info!("系统托盘菜单已初始化 (7 项)");

    Ok(TrayMenuRefs {
        silent_extract_item: silent,
        current_task_item: current,
    })
}
