## Why

数据浏览页面的三个区域（SchemaEditor 表单、侧栏任务列表、DataBrowser 表格及操作按钮）大面积使用硬编码 Tailwind 色阶（`slate-*`、`red-*`、`amber-*`、`blue-*`），完全绕过了 `globals.css` 的语义化 token 体系。现有的 4 品牌色 + Shadcn 基础映射只覆盖了"页面底色/文字/强调色"层，缺乏表单控件状态、数据高亮反馈、操作按钮危险态等场景的 token。需要按当前页面的实际需求，补全最小必要的一组语义 token，统一视觉一致性。

## What Changes

- **新增 4 个 CSS 语义变量**：`--warning`（警告色）、`--info`（信息高亮）、`--destructive-fg`（危险文字）、`--destructive-subtle`（危险态浅底），均为 HSL 数值格式，配齐 `.dark` 暗色映射
- **Tailwind 映射扩展**：`tailwind.config.ts` 新增 `warning`、`info`、`destructive-fg`、`destructive-subtle` 别名，`--destructive-fg` 以平级方式注册，不与既有 `destructive.foreground` 冲突
- **组件硬编码颜色替换**：SchemaEditor (~25 处)、index.tsx 侧栏 (~15 处)、DataBrowser (~6 处) 将硬编码颜色类替换为语义 token
- **设计规范同步**：`design-tokens` spec 补充新增 token 的映射表与使用场景

## Capabilities

### Modified Capabilities
- `design-tokens`: 新增 `--warning`、`--info`、`--destructive-fg`、`--destructive-subtle` 四个语义 token 的定义、映射和使用场景

## Impact

- CSS：`src/styles/globals.css`（`:root` + `.dark` 各新增 4 个变量）
- Tailwind 配置：`tailwind.config.ts`（新增 `warning`、`info`、`destructive-fg`、`destructive-subtle` 颜色别名）
- 组件：`SchemaEditor.tsx`、`index.tsx`（侧栏）、`DataBrowser.tsx`（class 替换，无功能变更）
- 无新增依赖，无 API 变更，无 **BREAKING** 变更
