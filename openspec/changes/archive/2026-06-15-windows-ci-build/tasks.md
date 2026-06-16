## 1. NSIS 打包配置

- [x] 1.1 在 `src-tauri/tauri.conf.json` 的 `bundle` 段中添加 `windows.nsis` 最小化配置（`languages: ["SimpChinese"]`，`installMode: "currentUser"`）
- [x] 1.2 确认未引入 `plugins.updater`、`plugins.telemetry` 或任何网络回连相关配置段

## 2. GitHub Actions 工作流

- [x] 2.1 创建 `.github/workflows/windows-build.yml`，使用 `workflow_dispatch` 手动触发器，包含 `actions/checkout@v4` 检出步骤，job 级别设置 `timeout-minutes: 30`
- [x] 2.2 配置 Rust 工具链安装步骤（`dtolnay/rust-toolchain@stable`，target `x86_64-pc-windows-msvc`）
- [x] 2.3 配置 Node.js + pnpm 安装步骤（`actions/setup-node@v4`，启用内置 pnpm 缓存）
- [x] 2.4 配置 Rust 依赖缓存（`actions/cache@v4`，覆盖 `~/.cargo` 和 `src-tauri/target`，key 基于 `Cargo.lock`）
- [x] 2.5 配置构建步骤：`pnpm install` → `pnpm tauri build`（指定 Windows target）
- [x] 2.6 配置 artifacts 上传步骤（`actions/upload-artifact@v4`，上传 NSIS `.exe` 安装包）

## 3. 验证

- [x] 3.1 提交并 push 到 GitHub，在 Actions 页面手动触发 `windows-build` workflow
- [x] 3.2 确认 workflow 成功完成，artifacts 中包含 `OrbitX_*_x64-setup.exe`（同时生成 MSI）
- [ ] 3.3 下载 `.exe` 并在 Windows 虚拟机中安装，验证应用可正常启动（需 Windows VM 环境，待 Phase 4 终端测试时执行）
