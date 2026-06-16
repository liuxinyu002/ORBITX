## Why

Phase-4 抓取引擎与全局快捷键的 Windows 实现（UIA/COM）已在代码中落地，但从未在 Windows 真机上编译、打包或运行验证。Roadmap 中 Phase-4 的 "windows 终端测试" 仍为待办状态。缺乏 Windows CI 流水线导致无法产出可安装的 `.exe` 包供虚拟机测试，阻塞 Phase-5 双端一致性推进。

## What Changes

- 新增 `.github/workflows/windows-build.yml`：`workflow_dispatch` 手动触发 + `push: tags: ['v*']` 自动发布，包含 Rust 与 pnpm 缓存，产出 NSIS `.exe` 安装包
- 通过 `CARGO_TARGET_DIR` 环境变量覆盖本地 `.cargo/config.toml` 中的自定义 target-dir，确保 CI 打包产物的路径可被 Tauri bundler 发现
- 修改 `src-tauri/tauri.conf.json`：补充 `bundle.active: true` 显式开启打包，补充 `bundle.windows.nsis` 配置（简体中文、当前用户安装）
- Tag push 时自动通过 `softprops/action-gh-release@v2` 创建 GitHub Release 并上传安装包
- **不引入** auto-updater、telemetry 或任何网络回连机制，保持孤岛架构

## Capabilities

### New Capabilities
- `windows-ci-build`: GitHub Actions Windows 编译打包流水线，手动或 tag 触发，产出 NSIS/MSI 安装器，tag 推送时自动创建 GitHub Release

### Modified Capabilities
<!-- 本次不修改任何功能 spec，仅为构建基础设施变更 -->

## Impact

- 新增 `.github/workflows/windows-build.yml`
- 修改 `src-tauri/tauri.conf.json`（`bundle.active`、`bundle.windows` 段）
- 不影响 Rust/React 业务代码、不影响 macOS 构建与功能
- 本地 `.cargo/config.toml` 通过 `.gitignore` 排除，CI 通过 `CARGO_TARGET_DIR` 覆盖
