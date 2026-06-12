use db::state::DbState;
use flexi_logger::{
    Cleanup, Criterion, DeferredNow, Duplicate, FileSpec, Logger, Naming,
};
use log::{self, Record};
use rusqlite::Connection;
use std::io::Write;
use std::sync::Mutex;
use tauri::Manager;

pub mod commands;
pub mod db;
pub mod errors;
pub mod models;
pub mod tray;

/// 自定义日志格式: `[YYYY-MM-DD HH:MM:SS] [LEVEL] [target] message`
fn log_format(
    w: &mut dyn Write,
    now: &mut DeferredNow,
    record: &Record,
) -> std::io::Result<()> {
    write!(
        w,
        "[{}] [{}] [{}] {}",
        now.format("%Y-%m-%d %H:%M:%S"),
        record.level(),
        record.target(),
        record.args()
    )
}

/// 执行 WAL checkpoint 以安全关闭数据库。
fn wal_checkpoint(app_handle: &tauri::AppHandle) {
    if let Some(state) = app_handle.try_state::<DbState>() {
        if let Ok(conn) = state.conn.lock() {
            log::info!("正在执行 WAL checkpoint");
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            log::info!("WAL checkpoint 已完成");
        }
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            // ── 日志基础设施 ──────────────────────────────────────────
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("无法获取 app data 目录");
            std::fs::create_dir_all(&app_data_dir).expect("无法创建 app data 目录");

            Logger::try_with_env_or_str("info")?
                .log_to_file(
                    FileSpec::default()
                        .directory(&app_data_dir)
                        .basename("orbitx")
                        .suffix("log"),
                )
                .rotate(
                    Criterion::Size(5_000_000),
                    Naming::Numbers,
                    Cleanup::KeepLogFiles(3),
                )
                .duplicate_to_stderr(Duplicate::All)
                .format(log_format)
                .start()?;

            log::info!(
                "OrbitX v{} 正在 {} 上启动",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS
            );

            // ── 数据库初始化 ──────────────────────────────────────────
            let db_path = app_data_dir.join("orbitx.db");
            log::info!("数据库路径: {}", db_path.display());

            let mut conn = Connection::open(&db_path).expect("无法打开数据库");

            log::info!("开始执行数据库迁移");
            db::migrations::run_migrations(&mut conn).expect("数据库迁移失败");
            log::info!("数据库迁移完成");

            app.manage(DbState {
                conn: Mutex::new(conn),
            });

            // ── 平台检测 + 窗口创建 ────────────────────────────────────
            let platform = std::env::consts::OS;
            let window_config = &app.config().app.windows[0];

            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), window_config)
                .expect("无法创建 WebviewWindowBuilder")
                .initialization_script(&format!(
                    "document.documentElement.setAttribute('data-platform', '{}');",
                    platform
                ))
                .build()
                .expect("无法创建主窗口");

            // macOS: 点击窗口关闭按钮应隐藏窗口而非退出应用
            let w = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = w.hide();
                }
            });

            log::info!(
                "主窗口已创建: {}x{} (platform: {})",
                window_config.width,
                window_config.height,
                platform
            );

            // ── 系统托盘 ──────────────────────────────────────────────
            let tray_menu_refs = tray::build_tray(app.handle())
                .expect("无法构建系统托盘");
            app.manage(tray_menu_refs);

            // ── 启动完成 ──────────────────────────────────────────────
            log::info!("OrbitX 启动完成");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet::check_ipc_status,
            commands::log::log_event,
            commands::model_config::save_model_config,
            commands::model_config::get_model_configs,
            commands::model_config::delete_model_config,
            commands::model_config::set_active_model,
            commands::model_config::get_active_model,
            commands::model_config::get_model_api_key,
            commands::task::create_task,
            commands::task::list_tasks,
            commands::task::get_task,
            commands::task::update_task,
            commands::task::delete_task,
            commands::task::set_active_task_id,
        ])
        .build(tauri::generate_context!())
        .expect("启动应用失败");

    // 统一处理所有退出路径的 WAL checkpoint
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            wal_checkpoint(app_handle);
        }
    });
}
