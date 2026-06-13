## 1. Tauri 窗口配置

- [x] 1.1 修改 `tauri.conf.json` overlay 窗口配置：width 480, height 48, transparent: true, center: false, decorations: false, shadow: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, visible: false
- [x] 1.2 在 `src-tauri/src/lib.rs` 快捷键 B 处理器中，`.show()` 前添加 `.set_size(LogicalSize::new(480.0, 48.0))` 重置为折叠尺寸

## 2. Rust 端光标定位与智能翻转

- [x] 2.1 更新 `compute_overlay_position()` 窗口参数：width 480, height 48, margin 20
- [x] 2.2 更新所有单元测试的参数值（window_width: 600→480, window_height: 340→48, flip_threshold 计算更新）
- [x] 2.3 确认智能翻转定位在 48px 高度下行为正确

## 3. JS 中间截断工具函数

- [x] 3.1 实现 `truncateMiddle(text: string, maxWidth: number): string` — Canvas measureText 精确截断，格式 `"前段文字...*...后段文字"`
- [x] 3.2 Canvas 不可用时降级为字符数估算（前 40% + "..." + "*" + "..." + 后 40%）
- [x] 3.3 边界情况：空文本、极短文本（无需截断）、极窄容器（至少保留 prefix 3 + suffix 3 字符）
- [x] 3.4 单元测试：短文本不过截断、长文本中间截断、边界宽度

## 4. 前端胶囊工具栏布局

- [x] 4.1 重写 `src/routes/overlay.tsx` 根容器：透明窗口居中 flex 容器 → 顶部 48px 胶囊条
- [x] 4.2 胶囊条样式：`bg-popover`，`border border-border`，`rounded-lg`，`box-shadow: 0 1px 3px rgba(0,0,0,0.05)`，`px-6` 水平内边距，flex 水平排列
- [x] 4.3 左区（文本预览）：flex-1, min-w:0，使用 `truncateMiddle()` 渲染截断文本，`text-foreground text-sm`
- [x] 4.4 分隔线：`w-px h-5 bg-border mx-2 shrink-0`
- [x] 4.5 右区（任务切换按钮）：自适应宽度，max-w-[120px]，CSS `text-overflow: ellipsis` 兜底，chevron 图标旋转动画
- [x] 4.6 未来工具占位：分隔线 + 单色 SVG 图标（例如齿轮/方块），`opacity: 0.4`，hover/focus 时 `opacity: 1` + tooltip（`title` 属性），`tabindex: 0`

## 5. 状态渲染

- [x] 5.1 骨架态：文本区 pulsing placeholder（`bg-muted animate-pulse rounded h-5 w-3/4`），任务区保留上次状态
- [x] 5.2 内容态：`truncateMiddle()` 截断文本展示
- [x] 5.3 空白态：`"未发现选中文本"`（`text-muted-foreground text-sm`）
- [x] 5.4 权限引导态：`"请在系统设置中授权辅助功能"` + 重试按钮（`text-xs text-primary hover:underline`）
- [x] 5.5 超时/错误降级：toast 提示，UI 进入空白态

## 6. 下拉列表 + 动态 resize

- [x] 6.1 下拉面板组件：`position: absolute; left: 0; top: 100%` 相对任务按钮定位，`bg-popover`，`border border-border`，`rounded-lg`，`box-shadow: 0 4px 12px rgba(0,0,0,0.08)`
- [x] 6.2 下拉宽度：`min-width: 100%`（不小于按钮），`max-width` 约束不超出胶囊右边界
- [x] 6.3 任务列表项：py-2 px-3，激活项左侧 `✓` + `font-weight: 500`，hover/focus `bg-muted`，focus 加 `ring-2 ring-inset ring-primary/30`
- [x] 6.4 `max-height: 216px`（6 项），超出 `overflow-y: auto`
- [x] 6.5 展开流程：`setSize(480, expandedHeight)` → `setDropdownOpen(true)` → CSS 渐入（opacity + translateY(-4px→0), 150ms ease-out）
- [x] 6.6 收起流程：`setDropdownClosing(true)` → CSS 渐出（opacity:0 + translateY(-4px), 150ms ease-in）→ `onTransitionEnd` → `setSize(480, 48)` → `setDropdownOpen(false)`
- [x] 6.7 fallback timer：展开后 300ms 若 `onTransitionEnd` 未触发，强制 resize 回 48px
- [x] 6.8 `expandedHeight` 计算：`48 + min(tasks.length, 6) * 36 + 8`

## 7. 键盘与焦点交互

- [x] 7.1 Esc 分层关闭：下拉打开→先关下拉（含渐出+resize）；下拉已关→隐藏 overlay
- [x] 7.2 Enter 键：下拉打开时选中高亮项并关闭下拉
- [x] 7.3 上下箭头：下拉打开时移动高亮索引（不提交），滚动跟随
- [x] 7.4 Click-outside：点击胶囊外区域关闭下拉
- [x] 7.5 窗口失焦隐藏 overlay（`Focused(false)`），权限引导态除外

## 8. 任务操作与降级

- [x] 8.1 收到 `grab-completed`（source: "shortcut-b"）→ 调用 `list_tasks` 刷新任务数据
- [x] 8.2 选中任务 → 乐观更新本地状态 + `set_active_task_id` → 失败则回滚 + toast
- [x] 8.3 选中已激活任务 → `set_active_task_id(null)` 取消激活
- [x] 8.4 `list_tasks` 失败 → 不展开下拉，toast "任务列表加载失败"

## 9. 日志埋点

- [x] 9.1 关键路径日志（中文消息，`log()` 桥接）：光标位置、智能翻转、窗口 clamp、任务加载/切换、grab 完成、动态 resize

## 10. 验证

- [x] 10.1 视觉验证：胶囊圆角 + 边框 + 阴影，文本截断格式正确，未来工具占位显示，暗色模式自动适配
- [x] 10.2 交互验证：任务下拉渐入/渐出 + 动态 resize，Esc 分层关闭
- [x] 10.3 定位验证：光标位置获取 + 智能翻转（下方/上方）+ 边界 clamp
- [x] 10.4 降级验证：list_tasks 失败不展开下拉，set_active_task_id 失败 toast + 回滚
- [x] 10.5 现有测试通过：`compute_overlay_position` 单元测试参数更新后全部通过
