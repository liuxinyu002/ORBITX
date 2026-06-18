## 1. CSS 变量新增

- [x] 1.1 `:root` 下新增 `--warning`、`--info`、`--destructive-fg`、`--destructive-subtle` 四个变量，HSL 数值格式，与现有变量格式保持一致
- [x] 1.2 `.dark` 下为四个新变量配置暗色映射，高亮色降低饱和度、信息/危险背景翻转为深色底

## 2. Tailwind 配置扩展

- [x] 2.1 `tailwind.config.ts` 的 `colors` 扩展区新增 `warning`、`info`、`destructive-fg`、`destructive-subtle` 四个顶级别名，映射到对应 CSS 变量

## 3. SchemaEditor 颜色替换

- [x] 3.1 替换所有表单/容器类硬编码颜色：`text-slate-*` → `text-foreground` / `text-muted-foreground`，`bg-slate-*` → `bg-muted`，`border-slate-*` → `border-border` / `border-input`
- [x] 3.2 替换状态/反馈类硬编码颜色：`text-amber-600` → `text-warning`，`text-red-500` → `text-destructive-fg`，`hover:bg-red-50` / `hover:text-red-500` → `hover:bg-destructive-subtle` / `hover:text-destructive-fg`

## 4. 侧栏 (index.tsx) 颜色替换

- [x] 4.1 替换所有容器/交互类硬编码颜色：`bg-slate-*` → `bg-muted`，`border-slate-200` → `border-border`，`text-slate-*` → `text-foreground` / `text-muted-foreground`，`hover:bg-slate-50` → `hover:bg-muted`
- [x] 4.2 替换删除按钮悬停态：`hover:text-red-500` / `hover:bg-red-50` → `hover:text-destructive-fg` / `hover:bg-destructive-subtle`

## 5. DataBrowser 残留硬编码替换

- [x] 5.1 新行高亮 `bg-blue-50/50` → `bg-info/50`
- [x] 5.2 确认删除态：`text-red-600` → `text-destructive-fg`，`bg-red-50` → `bg-destructive-subtle`，`focus:bg-red-100` → `focus:bg-destructive-subtle`，`focus:text-red-700` → `focus:text-destructive-fg`

## 6. 验证

- [x] 6.1 `tsc --noEmit` 通过（前端类型检查，确认新 Tailwind 别名可被正确解析）
- [x] 6.2 `grep -rn 'slate-' src/routes/tools/structured-extractor/` 无匹配（确认 SchemaEditor + 侧栏无残留硬编码 slate 色阶）
- [x] 6.3 `grep -rnE 'red-[0-9]|amber-[0-9]|blue-[0-9]' src/routes/tools/structured-extractor/` 无匹配（确认无残留硬编码状态色）
