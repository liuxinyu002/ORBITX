## Context

当前 overlay 是 600×340 透明窗口 + 56px 胶囊 + 预分配透明下拉区。需要完全重构为真正的水平胶囊工具栏：48px 高、DESIGN.md 圆角、多工具槽位水平排列、动态 resize 下拉。macOS 优先开发。

## Goals / Non-Goals

**Goals:**
- 窗口 480×48（折叠态），透明，动态 resize 替代预分配区域
- 圆角胶囊：`border-radius: 8px`（`--radius`），`border: 1px solid` + `--border` token，极细阴影
- 水平多工具槽位布局，分隔线区隔，未来工具占位（单色图标 + opacity: 0.4）
- JS 中间截断：`"前段文字...*...后段文字"`
- 下拉动态 resize：渐入展开 → 渐出收起 → `onAnimationEnd` 触发 `setSize()` 复原
- 快捷键 B 处理后 `set_size()` 重置为折叠尺寸再 show
- 颜色跟随全局 DESIGN.md token 体系，暗色模式通过 CSS 自定义属性自动适配

**Non-Goals:**
- 不实现搜索/翻译/复制等操作按钮（Phase 5）
- 不实现命令输入框（Phase 5）
- 不修改 `list_tasks` / `set_active_task_id` 的 Rust 实现
- 不做窗口宽度自适应（固定 480px）

## Decisions

### 1. 动态 resize（方案 A）替代预分配透明区

**选择**: 折叠态窗口 480×48。下拉展开时前端调用 `getCurrentWebviewWindow().setSize(PhysicalSize(480, expandedHeight))` 增高窗口；关闭时渐出动画完成后 `setSize(PhysicalSize(480, 48))` 复原。

**替代方案**: 预分配透明区（当前实现，方案 B）——48px 胶囊 + 200px+ 透明区 → 窗口 250px+ 高。折叠时下方大面积透明区浪费且不正常。

**resize 时机关键**: 收起必须在渐出动画 `onAnimationEnd` 之后调用 `setSize()`，避免视觉裁切（窗口突然变矮时动画还在进行）。

```
展开流程: 点击任务按钮 → setSize(480, expandedH) → setDropdownOpen(true) → CSS 渐入
收起流程: closeDropdown() → CSS 渐出 (150ms) → onAnimationEnd → setSize(480, 48) → setDropdownOpen(false)
```

**展开高度计算**:
```
item_height = 36px     // 每项任务（py-2 + text）
padding_v = 8px        // 下拉容器上下 padding
max_visible = 6        // 最多可见 6 项，超出滚动
visible_items = min(tasks.length, 6)
dropdown_h = visible_items * 36 + 8
expanded_h = 48 + dropdown_h   // 胶囊 48px + 下拉
```

### 2. 圆角矩形胶囊 + 边框 + 极细阴影

**选择**: `border-radius: 8px`（`--radius`，与 DESIGN.md 全局圆角体系一致）、`border: 1px solid` + `--border` token、`box-shadow: 0 1px 3px rgba(0,0,0,0.05)`（极度克制的基础阴影）。

窗口已 `transparent: true`，原生阴影关闭。边框承担主要边界划分职责，阴影仅提供微弱的浮动感。不依赖阴影作为主要视觉分隔——边框即可区分胶囊。

**与 DESIGN.md 的关系**: 完全遵循全局 DESIGN.md token 体系。胶囊背景使用 `--popover`，文字使用 `--foreground`，边框使用 `--border`。暗色模式通过 CSS 自定义属性自动适配，无需单独实现。

### 3. 颜色跟随 DESIGN.md Token 体系

**选择**: 不硬编码色值。所有颜色通过 CSS 自定义属性引用 DESIGN.md token：

| 用途 | Token | Tailwind | 浅色模式 | 暗色模式 |
|------|-------|----------|----------|----------|
| 胶囊背景 | `--popover` | `bg-popover` | #FFFFFF | #161C29 |
| 主文字 | `--foreground` | `text-foreground` | #030712 | #E2E4E7 |
| 边框/分隔线 | `--border` | `border-border` | #E4E7EB | #21283A |
| Hover 背景 | `--muted` | `bg-muted` | #F0F1F3 | #1F2533 |
| 辅助文字 | `--muted-foreground` | `text-muted-foreground` | #687080 | #7D838C |
| 交互强调 | `--primary` | `bg-primary` / `text-primary-foreground` | #64748B | #8FA0B5 |

下拉 hover 态使用 `--muted`，选中态字体加粗 `font-weight: 500`。暗色模式由 `.dark` CSS 类自动切换（`globals.css` 预定义），overlay 无需实现额外逻辑。

### 4. 水平多工具槽位布局

**选择**: 胶囊内部为水平 flex 容器，工具槽位由 `1px` 垂直分隔线（`--border` token）区隔。

```
┌──────────────────────────────────────────────────────────────┐ max 480px
│ px-6 │ "文字前半...*...后半" │ │ 任务名 ▾ │ │ ◆ │ │ ◇ │ px-6 │ 48px
└──────────────────────────────────────────────────────────────┘
       ← flex-1, min-w:0 →        auto,      单色图标 × N
                                   max-w:120px  opacity: 0.4
```

**槽位 1 — 结构化提取器**:
- 左区（文本预览）: `flex: 1; min-width: 0`，JS 中间截断
- 分隔线: `w-px h-5`，`bg-border`
- 右区（任务切换）: 自适应宽度，`max-width: 120px`，CSS `text-overflow: ellipsis` 兜底

**槽位 2+ — 未来工具占位**:
- 分隔线 + 单色 SVG 图标
- 未激活: `opacity: 0.4`
- Hover: `opacity: 1` + Tooltip（`title` 属性或自定义）
- 无文字标签
- 键盘可达性: 占位图标加入 Tab 键焦点顺序（`tabindex: 0`），聚焦时显示 tooltip（与 hover 行为一致），为未来工具激活预留键盘交互入口

**水平内边距**: `px-6`（24px），配合 48px 高度形成舒适的胶囊呼吸感，也为 `border-radius: 8px` 提供足够的内部空间。`px-6` 在 480px 总宽度中占 10%，属于合理范围——若后续发现文本预览区空间不足，可考虑降为 `px-4`（16px）释放更多文本空间。

### 5. JS 中间截断替代 CSS ellipsis

**选择**: 在 JS 中计算可用宽度，保留首尾字符，中间用 `*` 替代省略部分。

```
算法:
1. 获取容器可用像素宽度（Ref + getBoundingClientRect）
2. 用 Canvas measureText 估算文本宽度
3. 若文本宽度 ≤ 可用宽度 → 直接渲染原文
4. 若超出 → 二分查找 prefix 和 suffix 的长度，使得
   "prefix...*...suffix" 的总渲染宽度 ≤ 可用宽度
5. prefix 和 suffix 至少各保留 3 个字符

输出格式: "这是前面提取的文字...*...末尾的文字部分"
```

**降级**: Canvas 不可用时（SSR/测试环境），按字符数粗估截断（前 40% 字符 + "..." + "*" + "..." + 后 40% 字符）。

### 6. 任务下拉 — 自定义实现 + 动态 resize

**选择**: 手写 dropdown 组件（绝对定位 + CSS transition），与 Decision 1 的动态 resize 联动。

**定位**: 下拉列表 `position: absolute; left: 0; top: 100%` 相对于任务按钮定位。与任务按钮左对齐。宽度 `min-width: 100%`（不小于按钮宽度），`max-width` 约束不超出胶囊右边界（`right: 0` 或计算）。

**样式**: 下拉面板 `border-radius: 8px`（与胶囊一致），`bg-popover`，`border: 1px solid` + `--border` token，`box-shadow: 0 4px 12px rgba(0,0,0,0.08)`（略强于胶囊，表示弹出层级）。`max-height: 216px`（6 项），超出滚动。

**渐入动画**: `opacity: 0; transform: translateY(-4px)` → `opacity: 1; transform: translateY(0)`，`transition: 150ms ease-out`。

**渐出动画**: 同上反向，`transition: 150ms ease-in`。`onTransitionEnd` / `onAnimationEnd` 回调中触发 `setSize()` 复原窗口高度。

**选中标记**: 激活任务左侧显示 `✓` 标记 + `font-weight: 500`。

**任务按钮交互态**:
- **Default**: `text-foreground text-sm`，chevron 向下
- **Hover**: `bg-muted rounded-md`
- **Focus-visible**: `ring-2 ring-primary/40 ring-offset-1`（DESIGN.md 主色）
- **Disabled**（`list_tasks` 失败）: `opacity: 0.5; cursor: default`，点击无响应
- **Loading**（`list_tasks` 进行中）: chevron 替换为 16px 旋转 spinner
- **Active**（下拉打开）: `bg-muted`，chevron 旋转 180°

**下拉列表项交互态**:
- **Default**: `py-2 px-3 text-sm text-foreground`
- **Hover**: `bg-muted`
- **Focused**（键盘高亮）: `bg-muted outline-none ring-2 ring-inset ring-primary/30`
- **Selected**: 左侧 `✓` 标记 + `font-weight: 500`

### 7. 键盘交互

**Esc 分层关闭**: 下拉打开时先关下拉（含渐出 + resize），下拉已关闭时隐藏 overlay。

**Enter**: 下拉打开时，选中当前高亮项并关闭下拉。

**上下箭头**: 下拉打开时移动高亮项（不提交）。

**失焦**: 窗口 `on_window_event(Focused(false))` → 隐藏 overlay（权限引导态除外）。

### 8. 状态展示

与当前实现保持一致的五态流转：
1. **骨架态**: 文本区显示 pulsing placeholder（`bg-muted animate-pulse rounded h-5 w-3/4`）
2. **内容态**: 中间截断后的文本
3. **空白态**: `"未发现选中文本"`（`text-muted-foreground`）
4. **权限引导态**: `"请在系统设置中授权辅助功能"` + 重试按钮（`text-xs text-primary hover:underline`，使用 DESIGN.md 主色）
5. **超时/错误态**: toast 降级提示，UI 进入空白态

### 9. 任务数据刷新

overlay 收到 `grab-completed`（`source: "shortcut-b"`）事件时调用 `list_tasks` 刷新。不在 mount 时调用。每次快捷键触发都拿到最新激活任务状态。

### 10. Rust 侧变更

**lib.rs — 快捷键 B 处理器**: 在 `.show()` 前添加 `.set_size(LogicalSize::new(480.0, 48.0))`，确保每次出现时窗口为折叠尺寸。

**overlay_position.rs**: 更新 `compute_overlay_position()` 的窗口参数——`window_width: 480`, `window_height: 48`。更新所有单元测试的参数值。

**tauri.conf.json**: overlay 窗口配置更新为 `width: 480, height: 48, transparent: true, shadow: false, center: false, decorations: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, visible: false`。

### 11. 组件拆分

**选择**: `overlay.tsx` 作为容器组件负责状态协调与事件绑定，拆分子组件负责纯渲染。

- **`CapsuleToolbar`**: 胶囊容器，接收 children 作为工具槽位
- **`TextPreview`**: 纯渲染组件，接收截断后文本 + 状态类型（skeleton/content/empty/permission/timeout），根据状态渲染对应 UI
- **`TaskSwitcher`**: 任务按钮 + 下拉面板。接收任务列表、选中 ID、回调。内部管理 dropdown open/close 动画状态
- **`ToolSlot`**: 单个未来工具占位。接收图标 SVG + tooltip 文本

**容器职责**: `overlay.tsx` 持有所有状态（grabbed text、task list、active task、dropdown open、animation state），监听 `grab-completed` 事件和键盘事件，协调 `setSize()` 调用时机，将派生数据向下传递给子组件。

**替代方案**: 全部写在一个组件中——减少了文件数，但 300+ 行的单文件组件难以单独测试文本截断和下拉动画逻辑。

## 暗色模式

通过 CSS 自定义属性跟随系统 `prefers-color-scheme`。`globals.css` 已在 `.dark` 下定义所有 token 的暗色变体，overlay 使用 `var(--token)` 引用即可自动适配。无需在 overlay 代码中实现暗色切换逻辑。

## 超时策略

超时常量在 `overlay.tsx` 顶部集中定义：`GRAB_TIMEOUT_MS = 3000`、`LIST_TASKS_TIMEOUT_MS = 2000`、`SET_ACTIVE_TASK_TIMEOUT_MS = 2000`。

| 操作 | 超时 | 超时行为 |
|------|------|----------|
| grab_selected_text | 3s | 返回空结果，左区显示"获取文本超时" |
| list_tasks | 2s | 下拉不展开，保留上次状态，toast "任务列表加载失败" |
| set_active_task_id | 2s | toast "任务切换失败"，回滚本地状态 |

## 日志埋点

遵循 CLAUDE.md 第 4 条（中文消息，通过 `log()` 桥接）：

| 路径 | target | 消息 |
|------|--------|------|
| 光标获取失败 | "overlay" | "获取光标位置失败：{err}" |
| 智能翻转触发 | "overlay" | "空间不足，窗口翻转到光标上方，cursor_y={y}, screen_h={h}" |
| 窗口边界 clamp | "overlay" | "窗口位置已 clamp，原始 x={orig}, clamp 后 x={clamped}" |
| 任务列表加载失败 | "overlay" | "任务列表加载失败：{err}" |
| 任务切换成功 | "overlay" | "已切换激活任务，task_id={id}" |
| 任务切换失败 | "overlay" | "任务切换失败：{err}" |
| grab 完成事件 | "browser" | "收到 grab-completed 事件，request_id={id}" |
| 动态 resize | "overlay" | "窗口已 resize，h={height}" |

## Risks / Trade-offs

- **[resize 时机]** 若 `onAnimationEnd` 在某些情况下不触发（如快速连击），窗口可能卡在展开高度 → 加 fallback timer：展开时启动 300ms 定时器，若 `onTransitionEnd` 正常触发则 `clearTimeout()` 取消定时器后执行 resize；若 300ms 到期则强制执行 resize（此时 `onTransitionEnd` 再触发时 `setSize(480, 48)` 已是目标尺寸，无副作用）
- **[上方翻转 + 下拉展开]** 光标在屏幕底部、窗口翻转到上方后，下拉展开时窗口向下增长，可能遮挡光标或超出屏幕底部 → 边缘场景暂不处理，标记为已知限制
- **[Canvas measureText 不可用]** SSR/测试环境无 Canvas → 降级为字符数估算
- **[极窄容器]** 文本区被压缩到极窄时（< 100px），截断算法可能只保留 3+3 字符 → 够用，不做额外处理
