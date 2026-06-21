## Context

Phase-5 提取管线成功后仅通过 sonner toast ("已提取") 反馈，静默提取场景下用户极易错过。需要一个轻量级的视觉反馈通道：出现在光标附近，展示有意义的提取摘要，短暂停留后自动消失。

本设计遵循根目录 [DESIGN.md](../../../DESIGN.md) 的设计令牌、色彩规范与组件状态约定。

该 toast overlay 与现有命令面板 overlay 职责完全不同：
- 命令面板 overlay：交互型（任务选择、派发确认、降级处理）
- Toast overlay：展示型（消息通知，零交互，自动消失）

因此采用独立窗口而非在 overlay 内加状态。

## Goals / Non-Goals

**Goals**:
- Shortcut A 按下后**立即**在光标附近弹出 loading toast（Lottie 涟漪动画），消除按键后的反馈黑洞
- 提取成功后切换为 success toast：任务名 + 提取字段预览，2.5 秒后自动 fade-out
- 提取失败后切换为 error toast：错误图标 + 简短错误信息，2.5 秒后自动 fade-out
- Loading 态无自动消失，直到提取完成（由后续 `state` 切换覆盖）
- 独立组件，未来可复用于其他通知场景（手动派发成功、强制入库成功等）

**Non-Goals**:
- 降级/不相关通知 — 这些仍走 overlay
- 交互能力 — toast 纯展示，无按钮
- 替代所有 sonner toast — 只在 Shortcut A 提取路径上替换

## Decisions

### 1. 三态状态机模型

**决定**: Toast 组件由 `state` 字段驱动的三态状态机，单一事件通道 `toast:render`。

```
                 show_toast(state: "loading")
                      │
                      ▼
              ┌──────────────┐
   ┌─────────▶│   loading    │◀──────────┐
   │          │ ◎ 正在提取…  │           │
   │          └──────┬───────┘           │
   │                 │                   │
   │    ┌────────────┼────────────┐      │
   │    │            │            │      │
   │    ▼            ▼            │      │
   │ success      error           │      │
   │ ✅ 已提取    ✗ 提取失败      │      │
   │ 2.5s 消失    2.5s 消失      │      │
   │    │            │            │      │
   └────┴────────────┴────────────┘      │
                                         │
   快速重入：从 success/error 切回 loading ─┘
```

**理由**:
- 单一事件通道避免事件种类膨胀，前端内聚在一个 `switch(state)` 中处理三态 UI
- Loading 态不设自动消失定时器——提取可能耗时 30s+，由后续 `state` 切换自然驱动
- Success/Error 态各自维护 2.5s 定时器后 fade-out
- 快速重入时：loading → loading（重置，保持 loading UI），success/error → loading（立即切回）

### 2. 独立 webview 窗口 vs 复用 overlay 窗口

**决定**: 独立 `toast` 窗口。

**理由**:
- overlay 已承担命令面板的复杂状态机（skeleton/content/empty/permission/fallback），再加 toast 态会进一步增加职责
- 独立窗口的组件简单（~100 行），与 overlay 零耦合
- 未来扩展性强 — 任何场景都可以调用 `show_toast()` 弹消息

### 3. 窗口定位与外观

**决定**: 复用 `show_overlay_core` 的定位逻辑（光标下方 20px，智能翻转），但作为独立函数 `show_toast`。

外观:
- 宽度自适应内容（最大 480px），高度 ~48px
- 透明背景 + 无边框 webview，内容渲染胶囊样式的圆角卡片
- z-order: `alwaysOnTop`
- 暗色模式：toast 胶囊使用设计令牌（`--popover`, `--border`, `--radius` 等），暗色模式自动继承 `globals.css` 中 `.dark` 的对应变量值，无需额外适配

### 4. toast 内容结构

三种状态均保持相同宽度（480px），loading 态与 success/error 态首行高度一致，避免状态切换时的布局跳变。

**Loading 态**:
```
┌──────────────────────────────────────────────────┐
│  ◎  正在提取「简历库」…                           │
└──────────────────────────────────────────────────┘
```
- 单行：Lottie 涟漪动画（`lottie-react`，24×24px，`loop={true}`）+ 任务名 + "…"
- 动画颜色通过 CSS `stroke: currentColor` 继承容器 `text-foreground`，暗色/亮色模式自动跟随
- 使用设计令牌 `--popover` 背景 + `--foreground` 文本，暗色模式自动继承，无玻璃态效果
- 无自动消失

**Success 态**（同原设计）:
```
┌──────────────────────────────────────────────────┐
│  ✓  已提取到「简历库」           ·  3 条          │
│     姓名: 张三  |  电话: 138xxxx  |  邮箱: zh@...  │
└──────────────────────────────────────────────────┘
```
- 首行: 绿色 ✓ + message + record count badge
- 次行: 前 3 个字段的 key:value 预览，每个值截断到 ~20 字符，用 `|` 分隔
- 若无字段或数据为空，只显示首行

**Error 态**:
```
┌──────────────────────────────────────────────────┐
│  ✗  提取失败：调用超时                             │
└──────────────────────────────────────────────────┘
```
- 单行：红色 ✗ + 错误消息（来自 pipeline 的简短描述）
- 2.5s 后自动消失

### 5. 自动消失机制

**决定**: Rust 侧根据 `state` 字段决定是否启动定时器：

- `state: "loading"` — **不启动定时器**。窗口保持可见，等待下一次 `show_toast` 调用切换状态。
- `state: "success"` / `state: "error"` — 启动定时器，读取 `TOAST_DURATION_MS`（默认 2500ms）后 hide。

Rust 侧读取 `TOAST_DURATION_MS` 环境变量（默认 2500ms），通过 `tokio::time::sleep(Duration::from_millis(duration))` 后调用 `hide()`。

Rust 侧 emit `toast:render` 时将 `duration_ms` 注入 `ToastPayload`，前端从 payload 中读取 `durationMs`，计算 `fadeStartMs = durationMs - 200` 启动 CSS fade-out 动画。前后端通过 payload 字段解耦，而非各自硬编码时间常量。

环境变量 `TOAST_DURATION_MS` 遵循项目惯例（参考 `.env.example` 中的 `CLIPBOARD_TIMEOUT_MS`、`VITE_EXTRACTION_TIMEOUT_MS`）。

**为什么不在前端用 setTimeout 后直接 hide？** 前端 `getCurrentWebviewWindow().hide()` 可以工作，但 Rust 侧做更可靠（避免前端未挂载时窗口残留）。

### 6. toast 窗口 blur-auto-hide

**决定**: toast 窗口失去焦点时不自动隐藏。只有 timer 触发 hide。toast 是无交互元素，用户点击它不会产生效果，但点击其他地方（切换窗口）不应让 toast 消失——用户可能正在做其他事，toast 应该独立完成它的生命周期。

## Data Flow

```
ExtractionListener.tsx          pipeline.ts             Rust                    toast-overlay.tsx
─────────────────────          ───────────             ────                    ────────────────
收到 task:silent-extract
  → invoke("show_toast", {
      state: "loading",
      message: "正在提取「简历库」…"
    })
                                                        show_toast command
                                                          → state="loading" → 不启动定时器
                                                          → emit("toast:render")
                                                          → set_position + show
                                                                                 listen("toast:render")
                                                                                   → switch(payload.state)
                                                                                   → "loading": 渲染 Lottie 涟漪动画
                                                                                   → 无 fade-out 定时器

  → runExtraction()
    mode="silent"
    → insert_extraction() OK
    → invoke("show_toast", {
        state: "success",
        message: "已提取到「简历库」",
        record_count: 3,
        preview_fields: [...]
      })
                                                        show_toast command
                                                          → state="success" → 启动 2.5s 定时器
                                                          → emit("toast:render")
                                                                                 → switch(payload.state)
                                                                                   → "success": 渲染 ✓ + 字段
                                                                                   → setTimeout(2.3s) → fade-out

    ── 或失败 ──
    → invoke("show_toast", {
        state: "error",
        message: "AI 提取失败: 调用超时"
      })
                                                        show_toast command
                                                          → state="error" → 启动 2.5s 定时器
                                                          → emit("toast:render")
                                                                                 → switch(payload.state)
                                                                                   → "error": 渲染 ✗ + 消息
                                                                                   → setTimeout(2.3s) → fade-out
```

### 7. Loading 动画：Lottie 涟漪替代 CSS spinner

**决定**: 使用 `lottie-react` 库渲染 `src/assets/tap tap.json` 涟漪动画，替代原 CSS `animate-spin` spinner。

**理由**:
- 涟漪（同心圆扩散）动画语义上贴合"信号发出、正在处理中"的等待状态，比旋转符号更贴近产品气质
- `lottie-react@2.4.1` 体积 ~14KB gzipped（含 `lottie-web` 转递依赖总计 ~64KB），开销可控，不引入重型依赖链
- 动画文件 60fps / 1 秒循环，几何类同心圆缩放后仍保持清晰，24px 尺寸下细节可辨识
- `loop={true}` 自然适配无限等待的 loading 状态，无需额外播放控制

**颜色适配方案**:
- `tap tap.json` 内硬编码 stroke 颜色为 `rgba(0.863, 0.882, 0.898, 1.0)`（`#DCE1E5`，浅灰蓝），`"a":0` 表示非动画静态值
- 该颜色与项目设计令牌无关，暗色模式下会与深色背景形成突兀色块
- **处理方式**: 不改动 JSON 源文件，在 Lottie 容器上通过 class 设置 `text-foreground`，利用 CSS 规则 `stroke: currentColor` 覆盖 SVG 内所有 stroke 属性。SVG presentation attribute 优先级为 0，author CSS 自然覆盖，无需 `!important`
- 亮色模式自动获得 `--foreground`（深色），暗色模式自动获得 `--foreground`（浅色），完美跟随主题

**尺寸**: 24×24px，保持现有单行布局（图标 + 文字），loading 态高度与 success/error 首行一致（避免状态切换时布局跳变）。

**风险**: 若 `lottie-react` 或动画 JSON 加载失败，降级回 CSS `animate-spin` spinner，保证 loading 态始终可见。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| toast 窗口与 overlay 窗口同时可见 | 互不影响 — 两个独立窗口，不同标签 |
| 快速连续触发 Shortcut A | `show_toast` 被调用时，先 hide 当前 toast 再重新 show（天然覆盖）；loading → loading 重置后保持 loading UI |
| 光标移动后 toast 位置过时 | 可接受 — toast 定位是"触发时光标位置"；loading 态可能持续较久，但每次 `show_toast` 调用时重新获取光标位置 |
| `show_toast` 调用失败（窗口缺失） | 降级到 sonner toast，确保反馈不丢失 |
| 提取完成后用户已切换窗口 | toast 仍显示在原光标位置，`alwaysOnTop` 确保可见；用户可能已不在那个屏幕上，但这属于可接受的范围（success/error 只显示 2.5s） |
| Loading 态长时间无响应 | 可接受 — 最长 30s（`VITE_EXTRACTION_TIMEOUT_MS` 默认值），超时后 pipeline 自动 abort 并切换到 error 态 |
| Lottie 库或动画 JSON 加载失败 | 降级到 CSS `animate-spin` spinner，loading 态始终可见 |
| 24px 尺寸下涟漪动画细节模糊 | 动画为几何类同心圆 + 描边变化，缩小后仍可辨识；渲染后目视确认描边粗细是否清晰 |

## Open Questions

无。
