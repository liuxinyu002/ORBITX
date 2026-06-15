## ADDED Requirements

### Requirement: Manual Windows build workflow

The system SHALL provide a GitHub Actions workflow that builds a Windows `.exe` installer on `workflow_dispatch` trigger.

#### Scenario: Developer triggers Windows build
- **WHEN** a developer navigates to the Actions tab and triggers `windows-build` workflow
- **THEN** the workflow starts on a `windows-latest` runner

#### Scenario: Build produces NSIS installer
- **WHEN** the workflow completes successfully
- **THEN** a `.exe` installer artifact named `OrbitX_*_x64-setup.exe` is available for download

### Requirement: Rust and pnpm dependency caching

The workflow SHALL cache Rust and pnpm dependencies to avoid redundant downloads across builds.

#### Scenario: Cargo cache hit
- **WHEN** a build is triggered and `Cargo.lock` has not changed since previous build
- **THEN** cached Cargo registry, git databases, and target directory are restored

#### Scenario: pnpm cache hit
- **WHEN** a build is triggered and `pnpm-lock.yaml` has not changed since previous build
- **THEN** cached pnpm store is restored

#### Scenario: Cache miss on dependency change
- **WHEN** `Cargo.lock` or `pnpm-lock.yaml` has changed
- **THEN** dependencies are fetched fresh and cached for subsequent builds

### Requirement: Windows NSIS bundle configuration

The system SHALL include minimal NSIS configuration in `tauri.conf.json` for `.exe` installer generation.

#### Scenario: NSIS installer language
- **WHEN** the installer is generated
- **THEN** the installer UI is displayed in Simplified Chinese

#### Scenario: NSIS install mode
- **WHEN** the installer is executed
- **THEN** it installs for the current user without requiring administrator privileges

### Requirement: No auto-updater or telemetry

The build SHALL NOT include any auto-updater, telemetry, or network-callback mechanism.

#### Scenario: Build dependencies exclude updater
- **WHEN** the application is built
- **THEN** `tauri-plugin-updater` is not listed in Cargo dependencies

#### Scenario: Configuration excludes updater plugin
- **WHEN** the `tauri.conf.json` is inspected
- **THEN** no `plugins.updater` section is present
