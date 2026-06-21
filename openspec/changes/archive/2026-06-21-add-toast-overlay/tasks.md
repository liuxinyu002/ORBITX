## 1. Rust: 新增数据结构和 show_toast command

- [x] 在 `src-tauri/src/grab/mod.rs` 中新增 `ToastPayload` 和 `FieldPreview` struct（带 Serde camelCase）
- [x] 在 `src-tauri/src/grab/mod.rs` 中新增 `show_toast()` 函数：读取 `TOAST_DURATION_MS` 环境变量（默认 2500）→ 获取光标位置 → emit `toast:render` → 定位 → show → sleep → hide
  - 日志覆盖：调用时 debug、光标获取失败时 warn、显示时 info、窗口缺失时 error
- [x] 在 `src-tauri/src/commands/grab.rs` 中新增 `show_toast` Tauri command，调用 `show_toast()`
- [x] 在 `src-tauri/src/lib.rs` 中注册 `show_toast` command handler
- [x] 为新增的 struct 和函数编写单元测试（`ToastPayload` serde round-trip, `show_toast` 参数验证等）

**验证**: `cargo test` 全部通过

## 2. Tauri: 新增 toast 窗口配置

- [x] 在 `src-tauri/tauri.conf.json` 中新增 `toast` 窗口配置（label: "toast", url: "/#/toast", transparent, alwaysOnTop, skipTaskbar, shadow: false）
- [x] 在 Rust setup 阶段对 toast 窗口调用 `set_shadow(false)`

**验证**: `cargo build` 成功，`tauri.conf.json` schema 校验通过

## 3. 前端: toast-overlay 组件（基础）

- [x] 新建 `src/routes/toast-overlay.tsx`
  - 监听 `toast:render` 事件
  - 渲染成功胶囊（首行: ✓ + message + record count badge, 次行: field previews）
  - 2300ms 后触发 fade-out CSS animation
  - 无交互元素
  - 日志通过 `log(level, target, message)` 桥接到 Rust 后端
- [x] 在 `src/App.tsx` 中注册 `/toast` 路由（不使用 root layout）

**验证**: `pnpm test` 全部通过（含新增 toast-overlay 单元测试）

## 4. 前端: pipeline 采用 toast overlay

- [x] 在 `src/agent/pipeline.ts` 中：
  - 提取成功路径（`routeResult` / force mode）: 构建 `ToastPayload` → `invoke("show_toast_command", { payload })` 替代 `toast.success("已提取")`
  - 从 `cleaned` 数据中提取前 3 个字段作为 `preview_fields`，每个 value 由 Rust 侧 `show_toast` 命令截断到 ≤20 字符（前端无需处理截断逻辑）
  - 删除对应的 `toast.success` 调用
  - `invoke("show_toast_command")` 失败时降级到 `toast.success("已提取")`，确保用户始终收到反馈

**验证**: `pnpm test` 全部通过，`pipeline.test.ts` 更新相关断言

## 5. 扩展: 三态状态机 + loading/error 反馈

### 5a. Rust: ToastState enum + 状态感知定时器

- [x] 在 `src-tauri/src/grab/mod.rs` 中新增 `ToastState` enum（`Loading`/`Success`/`Error`），`#[serde(rename_all = "camelCase")]`，序列化为小写字符串
- [x] `ToastPayload` 新增 `state: ToastState` 和 `duration_ms: u64` 字段
- [x] `show_toast()` 函数读取 `TOAST_DURATION_MS` 后注入 `payload.duration_ms`，emit 时前端可通过此字段计算 fade-out 起点
- [x] `show_toast()` 函数根据 `state` 分支：
  - `state: "loading"` → show 后不启动定时器，直接返回
  - `state: "success"` / `"error"` → show 后 sleep(duration) → hide（保持现有行为）
  - 日志新增 state 字段输出（loading 状态标注"无定时器"）
- [x] 更新单元测试：`ToastState` serde 序列化测试、`duration_ms` camelCase 序列化测试、状态分支测试

**验证**: `cargo test` 全部通过

### 5b. 前端: toast-overlay 三态渲染

- [x] 重构 `toast-overlay.tsx`，根据 `payload.state` 切换渲染：
  - **Loading 态**: 单行 Lottie 涟漪动画（`lottie-react`，24×24px，`loop={true}`）+ message，颜色通过 CSS `stroke: currentColor` 继承容器 `text-foreground`，无 fade-out 定时器
  - **Success 态**: 保持现有 UI，fade-out 起点从 `payload.durationMs` 动态计算：`fadeStartMs = durationMs - 200`
  - **Error 态**: 单行红色 ✗（`text-red-600`）+ message，fade-out 起点同上
- [x] 状态切换时清除旧的 fade-out 定时器，根据新 `state` 决定是否启动新定时器
- [x] 三态保持相同宽度（480px），loading 态高度与 success 首行一致，避免布局跳变

**验证**: `pnpm test` 全部通过（新增 loading/error 态渲染测试）

### 5c. 前端: ExtractionListener loading 触发

- [x] 在 `src/components/ExtractionListener.tsx` 中：
  - 收到 `task:silent-extract` 事件后、调用 `runExtraction()` 前，立即 `invoke("show_toast_command", { payload: { state: "loading", message: "正在提取「<taskName>」…" } })`
  - 此处无 taskName（尚未 fetch task），可用 `message: "正在提取…"`
  - `invoke` 失败时：`log("warn", "pipeline", "Loading toast 显示失败，降级到 sonner")`，并调用 `toast("正在提取…")` 兜底，确保用户 100% 收到视觉反馈

**验证**: `pnpm test` 全部通过

### 5d. 前端: pipeline 错误路径改为 toast overlay

- [x] 在 `src/agent/pipeline.ts` 错误路径中：
  - 模型调用失败（`stopReason === "error"`）→ `invoke("show_toast_command", { payload: { state: "error", message: "AI 提取失败: <简短原因>" } })`
  - 超时（`AbortError`）→ error toast: `"调用超时（<N>s）"`
  - 入库失败 → error toast: `"入库失败，请重试"`
  - JSON 解析失败 / 空响应 → error toast（force 模式）或保持现有 fallback 行为（silent 模式）
  - 删除对应 `toast.error(...)` 调用
  - `invoke("show_toast_command")` 失败时降级到 sonner toast
  - 保留 sonner `import { toast }` 用于降级场景

**验证**: `pnpm test` 全部通过，`pipeline.test.ts` 更新错误路径断言

## 6. 端到端验证

- [ ] macOS 上 `pnpm tauri dev`，Shortcut A (Cmd+Shift+E) 选中文本 → 确认 loading toast（Lottie 涟漪动画）**立即**出现在光标附近
- [ ] 提取成功 → loading toast 切换为 success toast，展示任务名 + 记录条数 + 字段预览，2.5s 后自动消失
- [ ] 提取失败（超时/模型错误）→ loading toast 切换为 error toast，展示错误消息，2.5s 后自动消失
- [ ] 连续两次触发 Shortcut A → 确认 loading → loading（重置）或 success → loading（切回）
- [ ] 提取判定不相关 → toast 消失，fallback overlay 正常出现

**验证**: 手动测试通过

## 7. 加载动画升级: CSS spinner → Lottie 涟漪动画

- [x] 安装 `lottie-react@2.4.1` 依赖（`pnpm add lottie-react@2.4.1`）
- [x] 在 `src/routes/toast-overlay.tsx` 中：引入 `Lottie` 组件和 `tap tap.json`，将 loading 态的 `<span className="shrink-0 animate-spin">⟳</span>` 替换为 `<Lottie animationData={tapAnimation} loop={true} style={{ width: 24, height: 24 }} />`
- [x] 添加 CSS 规则 `.lottie-icon svg [stroke] { stroke: currentColor; }` 覆盖动画 JSON 硬编码颜色，使图标自动跟随 `text-foreground` 主题色
- [x] 添加 Lottie 加载失败降级：try-catch 包裹 `Lottie` 渲染，失败时回退 CSS `animate-spin` spinner，保证 loading 态始终可见
- [ ] 验证 24px 尺寸下涟漪动画描边细节清晰可辨识

**验证**: `pnpm test` 全部通过，肉眼确认亮色/暗色模式下图标颜色正确跟随主题
