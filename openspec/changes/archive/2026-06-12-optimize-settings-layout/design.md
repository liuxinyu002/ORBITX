## Context

当前设置页面（`src/routes/settings.tsx`）采用单张居中卡片布局：`Card > CardHeader > CardContent > CardFooter`，整体包裹在 `flex flex-col items-center px-4 py-8` 中。卡片带有 shadow、rounded-xl、bg-white。页面在视觉上封闭、过时，且无法扩展更多设置分类。

根布局（`src/routes/__root.tsx`）渲染 `div.h-screen.flex.flex-col > Header(h-10) + main.flex-1`。当前 `main` 缺少 `min-h-0`，导致 flex 子元素在内容溢出时无法正确启用 `overflow-y-auto` 滚动。

目标：将设置页面重构为桌面端标准的左侧侧边栏 + 右侧内容区两栏扁平布局，移除所有 Card 组件包裹，为未来扩展设置分类做好准备。

## Goals / Non-Goals

**Goals:**
- 实现左侧 w-64 侧边栏 + 右侧 flex-1 内容区的两栏布局
- 移除 Card/CardHeader/CardContent/CardFooter 组件及其视觉效果
- 右侧内容区支持独立垂直滚动
- 底部操作按钮改为 border-t 分隔线样式
- 修复 `__root.tsx` 中 `main` 缺少 `min-h-0` 的问题
- 保持内部表单逻辑、状态管理、Tab 切换机制完全不变

**Non-Goals:**
- 不新增其他设置分类的实际内容（侧边栏仅 "AI 模型连接" 一项）
- 不改动 segmented control、表单校验、保存/重置/取消逻辑
- 不改动 AgentProvider 包裹方式
- 不添加路由级侧边栏切换（侧边栏为纯展示导航占位）

## Decisions

### D1: 侧边栏 + 内容区布局在 settings.tsx 内部实现，而非修改根布局

**选择**: 在 `settings.tsx` 最外层渲染 `h-full flex` 容器，内含 `<aside>` 和 `<main>`。

**理由**: 侧边栏是设置页面的专属导航，不影响其他路由（dashboard、tools/extractor）。将布局逻辑放在 settings.tsx 内，改动范围最小，不引入全局 layout 变更。

**备选方案**: 修改 `__root.tsx` 增加条件式侧边栏。拒绝——全局 layout 不应感知特定页面的导航需求。

### D2: 使用 Tailwind 固定宽度类 w-64，不做响应式侧边栏折叠

**选择**: 侧边栏固定 `w-64`（256px），不做 hamburger 折叠或响应式隐藏。

**理由**: 当前仅一个导航项，侧边栏内容极简。应用本身就是桌面端 Tauri 窗口，最小宽度已受 Tauri 窗口限制（800px），无需考虑移动端适配。

### D3: `main` 元素添加 `min-h-0` 而非 `overflow-hidden`

**选择**: 在 `__root.tsx` 中给 `<main>` 添加 `min-h-0`。

**理由**: `flex-1` 子元素在 flex column 中默认 `min-height: auto`，内容溢出时不会收缩而是撑大父容器。添加 `min-h-0` 后子元素可正确收缩，`overflow-y-auto` 才生效。`overflow-hidden` 也能解决问题但会隐藏溢出内容而非启用滚动，不如 `min-h-0` 语义准确。

### D4: 侧边栏导航项使用纯展示状态，不关联路由

**选择**: 侧边栏导航项不绑定 `react-router-dom` 路由切换，仅渲染激活态样式。

**理由**: 当前仅一项，无实际导航需求。未来扩展时再接入路由。

### D5: 底部操作栏用 border-t 替代 CardFooter

**选择**: `<div className="mt-12 pt-6 border-t border-slate-200 flex justify-between items-center">`。

**理由**: 与上方表单拉开视觉距离，提供清晰的层级分隔。border-t 比 shadow 或背景色更轻量，符合扁平化设计。

### D6: 页面背景色与侧边栏激活态配色

**选择**:
- 页面整体背景: `bg-[#F3F4F7]`（Warm Tinted Background，`hsl(240 14% 97%)`）
- 侧边栏激活态: `bg-white shadow-sm text-primary` + `font-semibold`
- 输入框: `bg-white shadow-sm border-slate-300`（白底卡片式，在 tinted background 上形成清晰的填写区域边界）

**理由**:

1. **页面背景用 #F3F4F7 而非 #FFF**: 取消 Card 后，设置页面不再是 elevated surface，回退到 tinted background，同时满足 **No-Pure Rule**——禁止大面积纯白。

2. **侧边栏激活态用白色卡片式高亮**: `bg-white shadow-sm text-primary` 在 tinted background 上形成清晰的选中态卡片感，与右侧内容区白色输入框形成视觉呼应。`text-primary` 提供明确的激活色指示，无需额外的左侧强调线。

3. **输入框用白底**: 在 tinted background 上，`bg-white shadow-sm` 的输入框形成清晰的填写区域边界，比透明背景 + 1px 边框的对比度更强，视觉层次更分明。模型选择区域同理使用白底卡片。

## Risks / Trade-offs

- **Card 组件变为无引用**: 移除 settings.tsx 的 Card 导入后，`src/components/ui/card.tsx` 可能不再被任何组件使用。不在此次改动中删除该文件，避免误删 dashboard 或其他地方的引用。→ 实现时确认引用情况后决定是否保留。
- **侧边栏仅一项显空旷**: w-64 宽度的侧边栏内仅一个导航项，视觉上可能显得稀疏。→ 这是有意为之的结构预留，未来添加设置分类后自然填满。
