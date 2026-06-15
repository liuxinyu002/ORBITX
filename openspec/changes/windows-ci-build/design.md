## Context

OrbitX 已完成 macOS 端 Phase 1-4 的全部开发与测试，Windows 端抓取引擎代码（`grab/windows.rs`，基于 `windows` crate 的 UIA/COM 实现）虽已落地但从未在 Windows 环境下编译或运行。当前项目无任何 CI/CD 流水线，Windows 打包完全不可用。

Roadmap Phase-4 明确标注 "windows 终端测试" 待办。Phase-5 数据提取管线依赖 Phase-4 文本抓取能力，双端行为差异需尽早暴露。

## Goals / Non-Goals

**Goals:**
- 在 GitHub Actions 上建立 Windows 编译打包流水线，产出可安装的 `.exe` 文件
- 开发者通过 `workflow_dispatch` 手动触发，按需构建
- Rust 与 pnpm 依赖缓存，避免每次从头拉取
- 安装包纯净：无 auto-updater、无遥测、无网络回连

**Non-Goals:**
- 不在 CI 上运行端到端测试（GUI 应用无法在 headless runner 上交互测试）
- 不涉及 macOS 构建（已有本地开发环境）
- 不修改 Rust/React 业务代码
- 不引入代码签名（MVP 阶段，VM 内手动安装即可）

## Decisions

### 1. Runner: `windows-latest`

选用 GitHub 官方 Windows runner（Server 2022）。Tauri v2 依赖 WebView2 运行时，Server 2022 已预装，无需额外配置。备选 `windows-2019` 无此预装。

### 2. 构建工具链

| 组件 | 方案 | 理由 |
|------|------|------|
| Rust | `dtolnay/rust-toolchain@stable` + `x86_64-pc-windows-msvc` | 稳定通道，MSVC 工具链无需额外 C++ 构建工具 |
| Node | `actions/setup-node` + pnpm | `pnpm-lock.yaml` 存在，与本地开发一致 |
| Tauri CLI | `cargo install tauri-cli` 或使用 `@tauri-apps/cli` (npm) | v2 推荐通过 npm 包使用，避免 Cargo 安装时间 |

### 3. 缓存策略

```
┌─────────────────────────────────────────────────────┐
│  Rust (actions/cache)                               │
│  ├── ~/.cargo/registry/index                        │
│  ├── ~/.cargo/registry/cache                        │
│  ├── ~/.cargo/git/db                                │
│  └── src-tauri/target/                              │
│  key = hash(Cargo.lock)                             │
├─────────────────────────────────────────────────────┤
│  pnpm (setup-node 内置 cache)                        │
│  └── pnpm store                                     │
│  key = hash(pnpm-lock.yaml)                         │
└─────────────────────────────────────────────────────┘
```

Cargo 缓存命中时可将构建时间从 ~20min 降至 ~3min。

### 4. 打包格式: NSIS `.exe`

用户明确选择 `.exe` (NSIS)。Tauri v2 NSIS 为默认安装器格式，无需额外依赖。MSI (WiX) 需要安装 WiX Toolset，增加 CI 复杂度，不做。

### 5. NSIS 配置：最简覆盖

仅设置语言与安装模式，不使用自定义安装向导页面、许可协议、启动画面：

```json
"bundle": {
  "windows": {
    "nsis": {
      "languages": ["SimpChinese"],
      "installMode": "currentUser"
    }
  }
}
```

- `installMode: "currentUser"` — 无需管理员权限，符合桌面工具定位
- 不设置 `displayLanguage`、`installerIcon` 等，使用 Tauri 默认行为

### 6. 孤岛架构保证

- Tauri v2 的 auto-updater 插件 (`tauri-plugin-updater`) **不在依赖中，不激活**
- Telemetry 不存在的保证：Cargo.toml 无相关依赖，Tauri v2 默认无遥测
- `tauri.conf.json` 不添加 `plugins.updater` 配置段
- 构建产物为单一 `.exe` 安装器，不携带后台服务或更新守护进程

### 7. 触发方式: `workflow_dispatch`

手动触发。不绑定 push/pull_request，因为：
- Windows 构建耗时长（首次 ~15-20min），无需每次 push 都跑
- 当前只有 macOS 开发环境，push 触发毫无意义
- Phase 4 Windows 测试按需进行，频率低

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|---------|
| `windows` crate 0.58 在 MSVC 下可能编译失败 | CI 首次运行即可捕捉编译错误，修复直接在分支上进行 |
| WebView2 虽预装但版本不确定 | Tauri v2 可指定 `webviewInstallMode`，默认使用系统已安装版本，不自动下载 |
| 首次构建无缓存时长 ~20min | 接受首次完整构建耗时，后续缓存命中可降至 3-5min |
| artifacts 过期（GitHub 默认 90 天） | 足够覆盖测试周期；可自行归档 Release |
| VM 测试需人工传输 `.exe` 文件 | 当前可接受；后续可考虑发布到 GitHub Release |
