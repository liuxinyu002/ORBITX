# Platform Detection

## Purpose

Define the platform detection mechanism that injects the operating system identifier into the frontend before React mounts, enabling platform-specific CSS without Flash of Unstyled Content (FOUC).

## Requirements

### Requirement: Rust-side platform detection
The Tauri setup hook SHALL detect the target platform using `std::env::consts::OS`, which returns one of `"macos"`, `"windows"`, or `"linux"` at compile time.

#### Scenario: macOS platform detected
- **WHEN** the app runs on macOS
- **THEN** `std::env::consts::OS` returns `"macos"`

#### Scenario: Windows platform detected
- **WHEN** the app runs on Windows
- **THEN** `std::env::consts::OS` returns `"windows"`

### Requirement: data-platform attribute injection via initialization_script
The platform value SHALL be injected into the frontend's `<html>` element as a `data-platform` attribute via `WebviewWindowBuilder::initialization_script()` during the Tauri setup hook. This API (Tauri ≥ 2.5.0) guarantees the script runs before any JavaScript in the page, achieving absolute zero FOUC. The main window SHALL be created manually in the setup hook (not auto-created), with `tauri.conf.json` window config set to `"create": false`.

```rust
use tauri::Manager;

tauri::Builder::default()
    .setup(|app| {
        let platform = std::env::consts::OS;
        tauri::WebviewWindowBuilder::from_config(
            app.handle(),
            &app.config().app.windows[0],
        )?
        .initialization_script(&format!(
            "document.documentElement.setAttribute('data-platform', '{}');",
            platform
        ))
        .build()?;
        Ok(())
    })
```

#### Scenario: data-platform set before first paint
- **WHEN** the React app mounts
- **THEN** `<html data-platform="macos">` or `<html data-platform="windows">` is already present
- **THEN** no Flash of Unstyled Content (FOUC) occurs for platform-specific styles

### Requirement: Window managed via setup hook
The main window SHALL be created programmatically in the Tauri setup hook using `WebviewWindowBuilder::from_config()` (not auto-created by Tauri). The `tauri.conf.json` window configuration SHALL set `"create": false` to delegate creation to the setup hook.

#### Scenario: Window created in setup hook
- **WHEN** the app launches
- **THEN** the main window is created by `WebviewWindowBuilder::from_config()` in the setup hook
- **THEN** the `initialization_script` has already set `data-platform` before any frontend code runs

### Requirement: CSS consumption via data-platform selectors
Frontend CSS SHALL consume the platform value using attribute selectors:
- `html[data-platform="macos"] .header { padding-left: 80px; }`
- `html[data-platform="windows"] .header { padding-right: 120px; }`

#### Scenario: macOS padding applied
- **WHEN** `<html data-platform="macos">` is set
- **THEN** the header has 80px left padding for traffic light clearance

#### Scenario: Windows padding applied
- **WHEN** `<html data-platform="windows">` is set
- **THEN** the header has 120px right padding for window control button clearance

### Requirement: Zero external dependencies
The platform detection mechanism SHALL use only Rust standard library (`std::env::consts::OS`) and Tauri built-in `WebviewWindowBuilder::initialization_script()` (Tauri ≥ 2.5.0). No third-party crates or Tauri plugins SHALL be required.

#### Scenario: No additional dependencies for platform detection
- **WHEN** reviewing `Cargo.toml`
- **THEN** no crate exists solely for platform detection purposes
- **THEN** `tauri` dependency version is constrained to ≥ 2.5.0
