# Project Scaffold

## Purpose

Define the initial project scaffold including Tauri v2 + React + TypeScript initialization, directory structure, and all configuration files with correct defaults.

## Requirements

### Requirement: Tauri v2 project initialization
The project SHALL be initialized with Tauri v2, React 18+, TypeScript 5+, and pnpm as the package manager. The `create-tauri-app` or equivalent scaffolding MUST produce a compilable binary (`cargo build`) and a runnable dev server (`pnpm dev` with hot-reload).

#### Scenario: Fresh project compiles and runs
- **WHEN** developer runs `pnpm install && pnpm dev`
- **THEN** the Tauri desktop window opens with the React app rendered inside
- **THEN** the dev server supports HMR (hot module replacement) for React components

#### Scenario: Rust backend compiles independently
- **WHEN** developer runs `cargo build` in `src-tauri/`
- **THEN** the Rust binary compiles without errors
- **THEN** all Rust crate dependencies resolve correctly

### Requirement: Directory structure
The project SHALL follow the standard Tauri v2 directory layout:

```
OrbitX/
├── src/                    # React frontend
│   ├── routes/             # React Router pages
│   ├── components/         # Shared UI components
│   ├── styles/             # globals.css
│   └── lib/                # Utility functions, API bindings
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── lib.rs          # Tauri setup, state, plugin registration
│   │   ├── commands/       # Tauri commands
│   │   ├── db/             # Database access layer
│   │   ├── models/         # Data models
│   │   ├── errors.rs       # Error types
│   │   └── tray/           # System tray logic
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/              # App icons
├── package.json
├── pnpm-lock.yaml
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── rust-toolchain.toml
└── vite.config.ts
```

#### Scenario: Directory structure matches scaffold
- **WHEN** project is initialized
- **THEN** all listed directories and files exist in the correct locations

### Requirement: Config files with correct defaults
The project SHALL include the following configuration files with the specified key settings:

- **`tauri.conf.json`**: productName "OrbitX", version "0.1.0", identifier "com.orbitx.app", window labeled "main" at 1280×800 with min 1024×700, decorations true, transparent false, center true, create false (window managed via WebviewWindowBuilder in setup hook), CSP null (development only)
- **`vite.config.ts`**: Tauri v2 Vite plugin configured
- **`tsconfig.json`**: strict mode enabled, path aliases configured (`@/` → `src/`)
- **`tailwind.config.ts`**: darkMode "class", theme extensions for brand colors and app surfaces, tailwindcss-animate plugin (Tailwind v3)
- **`postcss.config.js`**: `tailwindcss` and `autoprefixer` plugins (Tailwind v3 PostCSS pipeline)
- **`rust-toolchain.toml`**: Rust stable channel ≥ 1.77, Tauri ≥ 2.5.0
- **`package.json`**: package manager pnpm, scripts for `dev`, `build`, `preview`

#### Scenario: All config files present and valid
- **WHEN** code is checked out
- **THEN** all 7 config files exist at their expected paths
- **THEN** each file passes its respective schema validation
