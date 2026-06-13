use db::state::DbState;
use flexi_logger::{
    Cleanup, Criterion, DeferredNow, Duplicate, FileSpec, Logger, Naming,
};
use grab::constants::{MAX_GRAB_TOKENS, MAX_RAW_CHARS, SHORTCUT_COMMAND_PALETTE, SHORTCUT_SILENT_EXTRACT};
use grab::state::GrabEnvelope;
use grab::{GrabEngine, GrabError, GrabResult, GrabSource, PlatformGrabEngine};
use log::{self, Record};
use rusqlite::Connection;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Builder, Code, GlobalShortcutExt, Modifiers, ShortcutState};

pub mod commands;
pub mod db;
pub mod errors;
pub mod grab;
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

/// 统一清理路径：注销快捷键 → WAL checkpoint → 退出。
pub(crate) fn shutdown(app_handle: &tauri::AppHandle) {
    log::info!("正在执行应用清理...");

    // 注销全部全局快捷键
    if let Err(e) = app_handle.global_shortcut().unregister_all() {
        log::warn!("注销全局快捷键失败: {e}");
    } else {
        log::info!("已注销全部全局快捷键");
    }

    // WAL checkpoint
    wal_checkpoint(app_handle);

    log::info!("清理完成，退出应用");
    app_handle.exit(0);
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

            // ── 抓取状态队列 ──────────────────────────────────────────
            app.manage(grab::state::GrabState::new());
            log::info!("抓取状态队列已就绪（上限 {} 条，TTL {}ms）", grab::state::MAX_QUEUE_SIZE, grab::state::ENVELOPE_TTL_MS);

            // ── 悬浮窗 (overlay) ─────────────────────────────────────
            app.manage(grab::OverlayPermissionState::new());

            let overlay_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "overlay")
                .expect("未找到 overlay 窗口配置");

            let overlay = tauri::WebviewWindowBuilder::from_config(
                app.handle(),
                overlay_config,
            )
            .expect("无法创建 overlay WebviewWindowBuilder")
            .build()
            .expect("无法创建 overlay 窗口");

            // 失焦自动隐藏，权限引导态抑制
            // 也处理 CloseRequested：阻止关闭，仅隐藏
            let o = overlay.clone();
            overlay.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        log::debug!(target: "overlay", "收到 Focused(false)，is_visible={}", o.is_visible().unwrap_or(false));
                        if let Some(state) = o
                            .app_handle()
                            .try_state::<grab::OverlayPermissionState>()
                        {
                            if state.0.load(std::sync::atomic::Ordering::Acquire) {
                                log::debug!(target: "overlay", "权限引导态，抑制 blur-auto-hide");
                                return;
                            }
                        }
                        let _ = o.hide();
                        log::debug!(target: "overlay", "悬浮窗失焦已隐藏");
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        log::debug!(target: "overlay", "收到 CloseRequested");
                        api.prevent_close();
                        let _ = o.hide();
                        log::debug!(target: "overlay", "悬浮窗关闭请求已拦截，仅隐藏");
                    }
                    other => {
                        log::debug!(target: "overlay", "窗口事件: {:?}", other);
                    }
                }
            });

            log::info!("悬浮窗已预加载: {}x{}", overlay_config.width, overlay_config.height);

            // ── 系统托盘 ──────────────────────────────────────────────
            let tray_menu_refs = tray::build_tray(app.handle())
                .expect("无法构建系统托盘");
            app.manage(tray_menu_refs);

            // ── 全局快捷键 ──────────────────────────────────────────
            let silent_flag = Arc::new(AtomicBool::new(false));
            let palette_flag = Arc::new(AtomicBool::new(false));

            let silent_flag_h = Arc::clone(&silent_flag);
            let palette_flag_h = Arc::clone(&palette_flag);

            let shortcut_plugin = Builder::new()
                .with_shortcuts([
                    SHORTCUT_SILENT_EXTRACT,
                    SHORTCUT_COMMAND_PALETTE,
                ])?
                .with_handler(move |app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }

                    // 用 matches() 而非字符串比较：shortcut.to_string()
                    // 返回规范形式（如 "CommandOrControl"），与注册时的
                    // "CmdOrCtrl" 不相等，会导致静默丢事件。
                    let (source, flag): (GrabSource, Arc<AtomicBool>) =
                        if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyE)
                            || shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyE)
                        {
                            (GrabSource::ShortcutA, Arc::clone(&silent_flag_h))
                        } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space)
                            || shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space)
                        {
                            (GrabSource::ShortcutB, Arc::clone(&palette_flag_h))
                        } else {
                            log::warn!(target: "grab", "未识别的快捷键: {}", shortcut.to_string());
                            return;
                        };

                    // 去抖/在途保护：同一快捷键已有任务在跑则丢弃新触发
                    if flag
                        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
                        .is_err()
                    {
                        log::debug!(target: "grab", "快捷键 {} 已在途，忽略新触发", shortcut.to_string());
                        return;
                    }

                    let app_handle = app.clone();
                    let is_overlay = source == GrabSource::ShortcutB;
                    tauri::async_runtime::spawn(async move {
                        // 快捷键 B：先弹出悬浮窗骨架态（不等抓取完成）
                        if is_overlay {
                            if let Some(overlay) = app_handle.get_webview_window("overlay") {
                                let _ = overlay.show().and_then(|_| overlay.set_focus());
                                log::debug!(target: "overlay", "悬浮窗已弹出并聚焦（快捷键B）");
                            }
                        }

                        let raw_result = tauri::async_runtime::spawn_blocking(move || {
                            let engine = PlatformGrabEngine::new();
                            engine.grab_selected_text(MAX_RAW_CHARS)
                        })
                        .await
                        .unwrap_or_else(|e| {
                            Err(GrabError::Internal(format!(
                                "spawn_blocking panic: {e}"
                            )))
                        });

                        // token 估算截断 + 日志
                        let result = raw_result.map(|text| {
                            let char_count = text.chars().count();
                            let estimated = grab::estimate_tokens(&text);
                            if estimated > MAX_GRAB_TOKENS {
                                let (truncated_text, _) = grab::truncate_by_tokens(&text, MAX_GRAB_TOKENS);
                                let new_est = grab::estimate_tokens(&truncated_text);
                                log::info!(
                                    target: "grab",
                                    "已提取选中文本: {} 字符 → 截断至 {} 字符 (token 估算 {} → {})",
                                    char_count,
                                    truncated_text.chars().count(),
                                    estimated,
                                    new_est
                                );
                                GrabResult {
                                    text: truncated_text,
                                    truncated: true,
                                }
                            } else {
                                log::info!(
                                    target: "grab",
                                    "已提取选中文本 ({} 字符, 估算 {} token): {}",
                                    char_count,
                                    estimated,
                                    text
                                );
                                GrabResult {
                                    text,
                                    truncated: false,
                                }
                            }
                        });

                        if let Err(ref e) = result {
                            log::warn!(target: "grab", "抓取失败: {:?}", e);
                        }

                        let request_id = uuid::Uuid::new_v4().to_string();
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;

                        // 结果入队
                        if let Some(state) =
                            app_handle.try_state::<grab::state::GrabState>()
                        {
                            state.push(GrabEnvelope {
                                request_id: request_id.clone(),
                                source: source.clone(),
                                result,
                                created_at_ms: now_ms,
                            });
                        }

                        // 轻量通知前端
                        let _ = app_handle.emit(
                            "grab-completed",
                            serde_json::json!({
                                "requestId": request_id,
                                "source": source,
                            }),
                        );

                        // 释放在途标记
                        flag.store(false, Ordering::Release);
                    });
                })
                .build();

            match app.handle().plugin(shortcut_plugin) {
                Ok(()) => {
                    if let Some(refs) = app.try_state::<tray::TrayMenuRefs>() {
                        let _ = refs.silent_extract_item.set_text("静默提取: 已注册");
                    }
                    log::info!(
                        "全局快捷键已注册: {} / {}",
                        SHORTCUT_SILENT_EXTRACT,
                        SHORTCUT_COMMAND_PALETTE
                    );
                }
                Err(e) => {
                    log::warn!(
                        "全局快捷键注册失败: {e}。请检查是否与其他应用冲突"
                    );
                    if let Some(refs) = app.try_state::<tray::TrayMenuRefs>() {
                        let _ = refs.silent_extract_item.set_text("静默提取: 未注册");
                    }
                }
            }

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
            commands::grab::consume_grabbed_result,
            commands::grab::set_overlay_permission_state,
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
