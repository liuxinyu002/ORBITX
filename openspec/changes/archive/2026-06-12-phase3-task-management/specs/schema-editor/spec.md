## ADDED Requirements

### Requirement: Field 数据结构
前端 SHALL 定义以下 TypeScript 类型：

```typescript
interface Field {
  name: string;
  type: "String" | "Number" | "Date";
  required: boolean;
  description: string;
}

interface TaskSchema {
  fields: Field[];
}
```

#### Scenario: Field 实例
- **WHEN** 创建一个 Field
- **THEN** name 为非空字符串，type 为 "String"/"Number"/"Date" 之一，required 为 boolean，description 为字符串

### Requirement: 可视化表单编辑器布局
Schema 编辑器 SHALL 采用表格行式布局：

```
[Header Row]    字段名 | 类型 | 必填 | 说明 | 操作
[Field Row 1]   [input] [Button+Dropdown] [switch] [input] [delete btn]
[Field Row 2]   [input] [Button+Dropdown] [switch] [input] [delete btn]
...
[Add Field Button]
```

#### Scenario: 空 Schema 显示
- **WHEN** 任务尚未定义任何字段
- **THEN** 仅显示表头行 + "添加字段"按钮
- **THEN** 表头下方无数据行

#### Scenario: 多行字段展示
- **WHEN** 任务有 5 个字段
- **THEN** 表头下方渲染 5 行 Field Row

### Requirement: 字段增删改操作
编辑器 SHALL 支持以下字段操作：

- **新增**：点击"添加字段"按钮，在末尾追加一行默认字段 `{ name: "", type: "String", required: false, description: "" }`
- **删除**：点击行尾删除按钮，从列表中移除该行
- **修改**：直接编辑行内 input/select/switch，实时更新 draft state
- **字段名重复实时校验**：name 重复时在输入框下方显示校验提示

#### Scenario: 添加空白字段
- **WHEN** 点击"添加字段"
- **THEN** 列表末尾出现一行空字段
- **THEN** `isDirty` 标记为 true

#### Scenario: 删除字段
- **WHEN** 点击字段行的删除按钮
- **THEN** 该行从列表中移除
- **THEN** `isDirty` 标记为 true

#### Scenario: 修改字段类型
- **WHEN** 点击类型列的 Button 触发 DropdownMenuRadioGroup，选择 "Date"
- **THEN** 该字段的 `type` 变更为 "Date"
- **THEN** 当前选中项显示为 Button 文本，并带有 CheckIcon 标记
- **THEN** `isDirty` 标记为 true

### Requirement: Zod 校验规则
保存时 SHALL 执行以下 Zod 校验：

```typescript
const fieldSchema = z.object({
  name: z.string()
    .min(1, "字段名不能为空")
    .regex(/^[a-z_][a-z0-9_]*$/, "字段名必须以小写字母或下划线开头，且只能包含小写字母、数字和下划线"),
  type: z.enum(["String", "Number", "Date"]),
  required: z.boolean(),
  description: z.string().max(200, "说明文字不能超过 200 个字符"),
});

const taskSchemaValidator = z.object({
  fields: z.array(fieldSchema).refine(
    (fields) => {
      const names = fields.map(f => f.name);
      return new Set(names).size === names.length;
    },
    { message: "同一任务中的字段名不能重复" }
  ),
});
```

#### Scenario: 字段名重复
- **WHEN** 两个字段的 name 均为 "user_name"
- **THEN** Zod 校验失败，提示"同一任务中的字段名不能重复"
- **THEN** 不调用 `update_task`

#### Scenario: 字段名为空
- **WHEN** 某字段 name 为空字符串
- **THEN** Zod 校验失败，提示"字段名不能为空"

#### Scenario: 字段名不符合规范
- **WHEN** 字段 name 为 "UserName"（包含大写字母）
- **THEN** Zod 校验失败，提示必须以小写字母或下划线开头

#### Scenario: description 超长
- **WHEN** 字段 description 超过 200 字符
- **THEN** Zod 校验失败，提示"说明文字不能超过 200 个字符"

#### Scenario: 全部校验通过
- **WHEN** 所有字段 name 唯一、符合 snake_case、description 不超长
- **THEN** 调用 `update_task` 保存 Schema
- **THEN** `isDirty` 重置为 false

### Requirement: 草稿状态管理 (useTaskDraft)
`useTaskDraft` hook SHALL 管理以下状态：

- `fields: Field[]` — 当前编辑的字段列表
- `taskName: string` — 任务名称
- `taskDescription: string` — 任务描述
- `isDirty: boolean` — 是否有未保存变更
- `isSaving: boolean` — 是否正在保存
- `isGenerating: boolean` — AI 是否正在生成

`selectedTaskId` 变化时，hook SHALL：
1. 如果 `isDirty === true`，触发确认弹窗
2. 用户确认放弃 → 调用 `get_task` 初始化新 draft，`isDirty = false`
3. 用户取消 → 不切换任务

#### Scenario: 切换任务有未保存变更
- **WHEN** 用户点击侧边栏另一任务（dirty=true）
- **THEN** 弹出确认对话框："当前编辑内容尚未保存，是否放弃？"
- **THEN** 用户点击"取消" → 停留在当前任务
- **THEN** 用户点击"放弃" → 切换到新任务，重新加载

#### Scenario: 保存成功后重置 dirty
- **WHEN** 点击"保存修改"且校验通过、Rust 写入成功
- **THEN** `isDirty` 置为 false
- **THEN** Toast 提示"保存成功"

### Requirement: 保存修改流程
点击"保存修改"按钮 SHALL 执行以下流程：

1. Zod 校验 `fields` 数组
2. 校验失败 → Toast 第一个错误消息，不调用后端
3. 校验通过 → 调用 `update_task(id, None, Some(description), Some(JSON.stringify({ fields })))` — name 传 None 保留原值（name 通过失焦自动保存独立处理）
4. 通过 `invoke` 调用 Tauri command
5. 成功后 `isDirty = false`，Toast "保存成功"
6. 如果 name/description 变更，调用 `onSaved()` 刷新侧边栏

#### Scenario: 全部校验通过后保存
- **WHEN** 点击"保存修改"且 Zod 校验通过
- **THEN** 调用 `update_task` command
- **THEN** 成功后 `isDirty = false`

### Requirement: 右侧面板空状态（无选中任务）
当 `selectedTaskId === null` 时，右侧面板 SHALL 仅渲染空状态占位提示"请在左侧选择一个任务"。编辑器、AI Generation Zone、Action Bar 全部不渲染。

#### Scenario: 首次进入页面
- **WHEN** 用户进入 `/tools/extractor` 且未选中任何任务
- **THEN** 左侧栏显示任务列表
- **THEN** 右侧面板仅显示居中提示文字

#### Scenario: 选中任务后取消选中
- **WHEN** 用户点击已选中任务行（取消选中）或删除当前选中任务
- **THEN** `selectedTaskId` 置为 null
- **THEN** 右侧面板回到空状态占位

### Requirement: 任务名称失焦自动保存
任务名称输入框 SHALL 在失焦（onBlur）或回车时自动调用 `update_task`：

- 调用 `update_task(id, Some(name), None, None)` — 仅更新 name，跳过 description 和 schema
- 成功后触发 `onSaved()` 刷新侧边栏列表
- 失败时 Toast 错误信息，**并回退 `taskName` state 到服务端当前值**（通过 `get_task` 重新获取）

#### Scenario: 修改名称失焦保存
- **WHEN** 用户修改任务名称后点击其他区域
- **THEN** 调用 `update_task` 仅更新 name
- **THEN** schema 草稿不受影响（不触发保存）

#### Scenario: 修改名称保存失败回退
- **WHEN** 用户修改名称后失焦保存失败
- **THEN** Toast 错误信息
- **THEN** 输入框的值回退为失焦前的旧值（重新调用 `get_task` 获取服务端当前 name）

### Requirement: 导航守卫拦截未保存修改
当存在未保存的 Schema 修改（`isDirty === true`）时，系统 SHALL 拦截页面导航并弹出确认对话框。

- 通过 `NavigationGuardProvider` 提供守卫注册机制
- `useNavigationGuard` hook 暴露 `setGuard` 和 `checkGuard`
- 页面在 `isDirty` 时注册异步守卫函数，返回 `Promise<boolean>`
- Header 返回按钮在调用 `navigate(-1)` 前先执行 `checkGuard()`
- 守卫拒绝时导航不执行

#### Scenario: 有未保存修改时点击 Header 返回按钮
- **WHEN** `draft.isDirty === true`
- **AND** 用户点击 Header 的返回按钮
- **THEN** 弹出确认对话框："当前编辑内容尚未保存，是否放弃当前修改？"
- **THEN** 用户点击"取消" → 停留在当前页面
- **THEN** 用户点击"放弃" → 执行导航返回

#### Scenario: 无未保存修改时点击 Header 返回按钮
- **WHEN** `draft.isDirty === false`
- **AND** 用户点击 Header 的返回按钮
- **THEN** 直接执行导航返回，不弹出确认对话框
