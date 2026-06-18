## Context

当前 `globals.css` 定义了 4 个品牌色 + Shadcn UI 标准映射，形成项目的基础 token 体系。但数据浏览页面的三个区域（SchemaEditor 表单、侧栏任务列表、DataBrowser 表格及操作按钮）大面积使用硬编码 Tailwind 色阶，原因是有 3 类视觉场景没有被现有 token 覆盖：

1. **表单控件状态**：输入框底色、标签文字、toggle 关闭态 → 全用 `slate-*` 直接赋值
2. **数据与状态反馈**：新行到达高亮（`bg-blue-50/50`）、未保存修改警告（`text-amber-600`）→ 无对应状态 token
3. **危险操作多级态**：删除按钮默认 red-500、悬停 red-50/red-500、确认态 red-50/red-600、聚焦 red-100/red-700 → 仅有一个 `--destructive`（对应 red-500），无法覆盖多级交互

本次按需补全 4 个语义 token，覆盖以上三种缺失场景的最低必要粒度。

## Goals / Non-Goals

**Goals:**
- 新增 `--warning`、`--info`、`--destructive-fg`、`--destructive-subtle` 四个 CSS 变量，配齐 light/dark 双模式
- Tailwind 配置新增对应别名，`--destructive-fg` 以平级方式注册
- 替换 SchemaEditor、side panel (index.tsx)、DataBrowser 中所有硬编码颜色类为语义 token
- 同步更新 `design-tokens` spec

**Non-Goals:**
- 不建立超出当前页面需求的全局状态色体系（如 success、info-foreground 等）
- 不改变任何组件的功能行为、API 接口、交互逻辑
- 不引入新 npm/cargo 依赖
- 不修改 Shadcn UI 组件的内部颜色映射

## Decisions

### 1. Token 命名与 HSL 取值

**决策**：新增 4 个 token，均为纯 HSL 数值（不带 `hsl()` 包装），与项目现有约定一致。

| Token | Light Mode | 等价 Tailwind | 用途 |
|-------|-----------|--------------|------|
| `--warning` | `38 92% 50%` | amber-600 | 未保存修改等警告文案 |
| `--info` | `214 100% 97%` | blue-50 | 新数据行高亮背景（配合 `/50` 透明度做动画消退） |
| `--destructive-fg` | `0 72% 51%` | red-600 | 危险操作文字（字段名重复错误、确认删除） |
| `--destructive-subtle` | `0 86% 97%` | red-50 | 危险操作浅底（删除按钮悬停、确认删除高亮） |

**理由**：
- `--warning` 和 `--info` 是独立的状态色维度，不适合塞入现有的 `--muted`/`--secondary`/`--destructive` 体系
- `--destructive-fg` 独立于 `--destructive-foreground`（后者是白色，用于按钮上文字），二者使用场景不同——前者是独立出现的红色文字（错误提示、内联验证），后者是 destructive 按钮上的反白文字
- `--destructive-subtle` 给 hover/confirmation 提供浅色背景，避免在多行数据列表中大量使用 `--destructive` 本身（该色覆盖面积超过 5% 会破坏 accent 规则）

**替代方案**：复用 `--destructive` + opacity modifier 实现浅色背景。放弃此方案的原因：Tailwind 的 opacity modifier `bg-destructive/10` 会改变整个元素的透明度（包括文字），而不是仅作用于背景色，效果不可控。

### 2. 暗色模式映射策略

**决策**：信息高亮和警告色在 dark mode 下降饱和度、调暗亮度，避免在高密度数据界面上刺眼。

| Token | Light | Dark | 调整原则 |
|-------|-------|------|---------|
| `--warning` | `38 92% 50%` | `38 75% 52%` | 饱和度 92→75，略提亮度 |
| `--info` | `214 100% 97%` | `214 25% 16%` | 从浅蓝底翻转为深蓝底，在暗色表面 `224 35% 12%` 上形成可辨识的色差 |
| `--destructive-fg` | `0 72% 51%` | `0 70% 58%` | 饱和度微降，亮度微升 |
| `--destructive-subtle` | `0 86% 97%` | `0 40% 12%` | 从浅红底翻转为深红底，与 `--card` dark（`224 35% 12%`）形成可辨识色差 |

**理由**：dark mode 下蓝色/红色的大面积浅色背景会产生眩光感——这是因为暗色环境下人眼瞳孔放大，对高亮度更敏感。翻转为"深色底+文字"模式可维持信息层级同时减少视觉疲劳。此策略与 Shadcn 在 dark mode 下对 `--muted`（从 `220 14% 95%` 翻转为 `224 28% 16%`）的处理一致。

### 3. Tailwind 配置映射

**决策**：`tailwind.config.ts` 的 `colors` 扩展区新增以下别名，均为顶级键：

```ts
warning: "hsl(var(--warning))",
info: "hsl(var(--info))",
"destructive-fg": "hsl(var(--destructive-fg))",
"destructive-subtle": "hsl(var(--destructive-subtle))",
```

`destructive-fg` 作为独立顶级键注册，与已有的 `destructive.foreground` 互不干扰。使用时：
- `text-destructive` → 现有 destructive 背景色（red-500）
- `text-destructive-foreground` → 现有 destructive 上文字色（white）
- `text-destructive-fg` → 新增 危险文字色（red-600，独立出现）

### 4. 组件颜色替换策略

**决策**：三个组件中的硬编码色类按以下映射替换，不改变任何组件逻辑。

表单/容器类（已有 token 可覆盖）：
| 当前 | 替换为 |
|------|--------|
| `text-slate-700` | `text-foreground` |
| `text-slate-500` | `text-muted-foreground` |
| `text-slate-400` | `text-muted-foreground` |
| `text-slate-300` | `text-muted-foreground` |
| `bg-slate-50` | `bg-muted` |
| `bg-slate-100` | `bg-muted` |
| `bg-slate-200` | `bg-muted` |
| `hover:bg-slate-50` | `hover:bg-muted` |
| `border-slate-200` | `border-border` |
| `border-slate-100` | `border-border` |
| `border-slate-300` | `border-input` |

状态/反馈类（需要新 token）：
| 当前 | 替换为 |
|------|--------|
| `text-amber-600` | `text-warning` |
| `bg-blue-50/50` | `bg-info/50` |
| `text-red-500` | `text-destructive-fg` |
| `text-red-600` | `text-destructive-fg` |
| `bg-red-50` | `bg-destructive-subtle` |
| `focus:bg-red-100` | `focus:bg-destructive-subtle` |
| `focus:text-red-700` | `focus:text-destructive-fg` |
| `hover:text-red-500` | `hover:text-destructive-fg` |
| `hover:bg-red-50` | `hover:bg-destructive-subtle` |

`bg-white` 和 `shadow-sm` 按要求保留不动。

## Risks / Trade-offs

- **`slate-50` vs `--muted` 色差**：`slate-50`（#F8FAFC）→ `--muted`（#F1F3F5）有轻微偏灰，在表单输入框中视觉差异极小，不影响可读性。若后续遇到需要更浅表面的场景，可再新增 token。
- **`--info` dark 模式辨识度**：`214 25% 16%`（深蓝底）与 `--card` dark（`224 35% 12%`）的色差较微妙，需在 DataBrowser 实际渲染后目视确认。若色差不足，可调高 lightness 到 20%。
- **Tailwind 连字符 key**：`"destructive-fg"` 作为带连字符的 key 在 JS 中需引号包裹，但 Tailwind 的 CSS 生成不受影响，生成的 utility class 为 `text-destructive-fg`、`bg-destructive-subtle`。
