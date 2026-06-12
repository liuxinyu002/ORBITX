## Why

当前设置页面采用单卡片居中布局（Card + shadow + rounded-xl），视觉上显得封闭、过时，且不具备扩展性。改为左侧侧边栏 + 右侧内容区的扁平化两栏布局，既是桌面端现代设置页面的通用模式，也为未来新增设置分类（通用设置、外观等）预留了结构空间。

## What Changes

- 移除 `Card`/`CardHeader`/`CardContent`/`CardFooter` 组件，改为扁平化布局
- 新增左侧侧边栏（w-64），包含 "AI 模型连接" 导航项（激活态高亮）
- 右侧内容区直接裸露表单内容，无卡片包裹，内部 `max-w-4xl` 约束宽度
- 底部操作栏改用 `border-t` 分隔线，不再使用 CardFooter
- `__root.tsx` 的 `main` 元素添加 `min-h-0`，确保 flex 子元素溢出滚动正确
- 页面标题放大为 `text-2xl font-semibold`
- 内部双列表单（grid-cols-2）、Segmented Control 切换逻辑、状态缓冲机制保持不变

## Capabilities

### New Capabilities

- `settings-sidebar`: 设置页面左侧导航栏，显示设置分类菜单项，支持激活态高亮

### Modified Capabilities

- `settings-ui`: 布局从单卡片居中改为左侧侧边栏 + 右侧内容区扁平化布局；移除 Card 系列组件；底部操作栏改为 border-t 分隔线样式

## Impact

- `src/routes/settings.tsx` — 主要改动：移除 Card 导入，重构 JSX 布局结构
- `src/routes/__root.tsx` — 小改动：`main` 元素添加 `min-h-0`
- `src/components/ui/card.tsx` — 可能不再被任何页面引用（当前只有 settings 使用）
