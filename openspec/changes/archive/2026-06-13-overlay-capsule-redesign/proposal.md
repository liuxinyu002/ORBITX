## Why

当前胶囊 Overlay（600×340，预分配透明区域容纳下拉）仍然偏大、不够精巧。需要完全重构为真正的水平胶囊工具栏：48px 高、DESIGN.md 圆角、`--popover` 白底、多工具槽位水平排列——贴合光标、极简轻量。

## What Changes

- **窗口配置**: 480×48（折叠态），`transparent: true`，取消预分配透明区，改为动态 resize（展开下拉时窗口增高，收起后经由 `onAnimationEnd` 复原至 48px）
- **视觉风格**: 遵循全局 DESIGN.md token 体系。胶囊背景 `--popover`（浅色 #FFFFFF / 暗色 #161C29），文字 `--foreground`（浅色 #030712 / 暗色 #E2E4E7），`border-radius: 8px`（`--radius`），`border: 1px solid` + `--border` token，`box-shadow: 0 1px 3px rgba(0,0,0,0.05)`。禁止毛玻璃和复杂渐变。
- **布局结构**: 水平排列多工具槽位，`1px` 分隔线区隔。槽位 1（结构化提取器）含左区文本预览（flex-1, min-w:0）+ 右区任务切换（max-w:120px, 自适应宽度）；其余槽位为未来工具占位（单色图标，opacity: 0.4，hover tooltip）
- **文本截断**: JS 计算中间截断（保留首尾），格式 `"首段提取文字...*...末尾提取文字"`，替代 CSS `text-overflow: ellipsis`
- **任务下拉**: 点击展开 → 前端 `WebviewWindow.setSize()` 动态扩大窗口 → 下拉渐入；选择/关闭 → 渐出动画 → `onAnimationEnd` → `setSize()` 缩小回 48px。下拉与任务按钮左对齐，圆角 8px（与主胶囊一致）。宽度 ≥ 按钮宽度且不超出胶囊右边界
- **快捷键 B 处理器**: 新增 `.set_size(LogicalSize::new(480.0, 48.0))` 在 show 前将窗口重置为折叠尺寸
- **暗色模式**: 通过 CSS 自定义属性自动适配，无需额外实现

## Capabilities

### Updated Capabilities
- `capsule-overlay`: 完全重新定义——水平胶囊工具栏、JS 中间截断、动态 resize 下拉、未来工具占位
- `floating-overlay`: 窗口尺寸/边框/阴影策略变更，预分配透明区改为动态 resize
- `global-shortcut`: 快捷键 B 处理器中新增折叠态 `set_size()` 重置

## Impact

- `src-tauri/tauri.conf.json` — overlay 窗口配置（width/height/transparent/shadow）
- `src-tauri/src/lib.rs` — 快捷键 B 处理器中增加折叠态 `set_size()` 重置
- `src-tauri/src/overlay_position.rs` — 定位参数更新（窗口尺寸变更影响翻转阈值与 clamp）
- `src/routes/overlay.tsx` — 完全重写（水平工具栏 + JS 中间截断 + 动态 resize 下拉 + 工具占位）
- 无新增依赖 crate
- 无 API 破坏性变更
