# Logging

## Purpose

Define the unified logging infrastructure: frontend-to-Rust log bridging via Tauri Command, `env_logger` initialization, log file rotation, lifecycle log events, and graceful database shutdown.

## Requirements

### Requirement: Frontend logs bridged to Rust backend
The frontend SHALL NOT use `console.log`, `console.error`, or any browser console API for application logging. All log output (frontend and backend) SHALL flow through the Rust backend via a Tauri Command, using the `log` crate as the single logging facade.

#### Scenario: Frontend emits an info log
- **WHEN** the frontend calls `log('info', 'dashboard', 'Dashboard mounted')`
- **THEN** a Tauri `invoke('log_event', { level: 'info', target: 'dashboard', message: 'Dashboard mounted' })` is sent
- **THEN** the Rust `log_event` command dispatches it via `log::info!(target: "dashboard", "Dashboard mounted")`
- **THEN** `env_logger` writes it to console and/or file

#### Scenario: Direct console.log prohibited
- **WHEN** reviewing frontend source code
- **THEN** no `console.log`, `console.warn`, `console.error` calls exist outside of the `logger.ts` utility

### Requirement: log_event Tauri Command
The Rust backend SHALL expose a `log_event` Tauri Command with the following signature:

```rust
#[tauri::command]
fn log_event(level: String, target: String, message: String) -> CommandResult<()>
```

The Command SHALL dispatch the log entry to the `log` crate using the appropriate macro (`error!`, `warn!`, `info!`, `debug!`) based on the `level` parameter. Unknown levels SHALL default to `warn!`.

#### Scenario: Error log dispatched via error! macro
- **WHEN** `log_event` is called with `level = "error"`
- **THEN** the message is emitted via `log::error!(target: &target, "{}", message)`

#### Scenario: Unknown log level falls back to warn
- **WHEN** `log_event` is called with `level = "critical"` (unknown)
- **THEN** the message is emitted via `log::warn!(...)` with a note that the level was unrecognized

### Requirement: env_logger initialization
The Rust binary SHALL initialize `env_logger` in `main.rs` before any Tauri setup. The logger SHALL be configured with:

- **Default log level**: `info` (production) / `debug` (development via `RUST_LOG` env var)
- **Output targets**: stderr (console) + file (`$APP_DATA_DIR/orbitx.log`)
- **Format**: `[YYYY-MM-DD HH:MM:SS] [LEVEL] [target] message`

The log level SHALL be overridable at runtime via the `log_level` key in `app_kv`.

#### Scenario: Logger initialized before Tauri setup
- **WHEN** the app process starts
- **THEN** `env_logger::init()` is called before `tauri::Builder::default()`
- **THEN** the first log line captures the app version and platform

#### Scenario: Log level read from app_kv at startup
- **WHEN** the app starts and `app_kv` contains `log_level = "debug"`
- **THEN** the logger is configured at `debug` level
- **THEN** debug-level messages appear in the log output

### Requirement: Frontend logging utility (logger.ts)
The frontend SHALL provide a single logging utility at `src/lib/logger.ts`:

```typescript
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export async function log(level: LogLevel, target: string, message: string): Promise<void> {
  await invoke('log_event', { level, target, message });
}
```

All frontend modules SHALL import and use this function. The function SHALL be the only call site for `invoke('log_event', ...)`.

#### Scenario: Frontend component logs through utility
- **WHEN** a React component needs to log
- **THEN** it imports `{ log } from '@/lib/logger'` and calls `log('error', 'Header', 'Failed to load route')`
- **THEN** it does NOT call `invoke('log_event', ...)` directly

### Requirement: Lifecycle log events
The application SHALL emit log events at the following lifecycle points:

| Event | Level | Target | Message |
|-------|-------|--------|---------|
| App startup | `info` | `app` | `"OrbitX v{version} starting on {platform}"` |
| DB migration done | `info` | `db` | `"Database migration completed, schema_version={version}"` |
| Window created | `info` | `window` | `"Main window created: {width}x{height}"` |
| Tray menu built | `info` | `tray` | `"System tray menu initialized ({n} items)"` |
| IPC status check | `debug` | `ipc` | `"IPC status check: {status}"` |
| App shutting down | `info` | `app` | `"App shutting down"` |

#### Scenario: Startup lifecycle events appear in order
- **WHEN** reading the log file after a normal app launch
- **THEN** the startup sequence is traceable: app start → DB migration → window created → tray initialized

### Requirement: Graceful database shutdown
When the application exits (via tray "退出" or OS quit signal), the Rust backend SHALL execute `PRAGMA wal_checkpoint(TRUNCATE)` on the database connection before calling `app.exit(0)`. This ensures WAL data is flushed to the main database file and WAL/SHM files are cleaned up.

#### Scenario: Clean exit flushes WAL
- **WHEN** the user clicks "退出" in the tray menu
- **THEN** `PRAGMA wal_checkpoint(TRUNCATE)` is executed on the Mutex-guarded connection
- **THEN** `app.exit(0)` is called only after the checkpoint completes
- **THEN** no WAL or SHM files remain after exit
