## ADDED Requirements

### Requirement: 评估与计划合并输出
当用户触发 `/opsx:harden` 后，Review 和 Plan 阶段 SHALL 合并为单一 "Harden Assessment" 输出。若无 CRITICAL 风险，系统 SHALL 只输出一次摘要并在末尾给出唯一决策点，不再分阶段打断用户。

#### Scenario: 无 CRITICAL 风险时合并输出
- **WHEN** 评估未发现 CRITICAL 级别风险
- **THEN** 系统输出合并的评估摘要（风险计数 + 涉及模块 + 验证范围概要 + 一行执行计划）
- **THEN** 紧随其后输出决策提示 "是否继续？"
- **THEN** 不单独输出完整的 Review 表格或 Plan 表格

#### Scenario: 存在 CRITICAL 风险时阻断
- **WHEN** 评估发现 CRITICAL 级别风险
- **THEN** 系统在评估阶段停止，不进入决策点
- **THEN** 明确展示 CRITICAL 项的具体内容和推荐处理方式
- **THEN** 等待用户处理后再继续

### Requirement: 摘要优先与按需展开
Harden Assessment 的顶层输出 SHALL 只包含核心状态摘要，详细数据（契约点映射表、Not In Scope 分类、完整测试命令列表）仅在用户明确请求 "详情" 时展开。

#### Scenario: 默认输出摘要
- **WHEN** 系统输出 Harden Assessment
- **THEN** 顶层显示风险计数（CRITICAL/WARNING/NOTE 各数量）
- **THEN** 顶层显示涉及的模块名称列表和验证范围概要
- **THEN** 顶层显示一行执行计划概要（Automated / E2E / Manual 各几项、最大重试轮次）
- **THEN** 不自动输出完整契约点映射表

#### Scenario: 用户请求详情
- **WHEN** 用户在决策点输入 "详情" 或 "details"
- **THEN** 系统展开完整契约点映射表（含源码位置、现有测试覆盖、风险等级）
- **THEN** 系统展开 Not In Scope 分类（含每项的排除类别和原因）
- **THEN** 展开后再次显示决策提示

### Requirement: 执行阶段心跳反馈
Execute 阶段每处理一个契约点 SHALL 输出 `[N/M]` 格式的进度标记，让用户感知系统正在运转且未卡死。

#### Scenario: 步骤开始时报告进度
- **WHEN** 开始处理一个契约点的测试编写
- **THEN** 输出 `[N/M]` 进度标记和当前操作简述
- **THEN** 进度标记包含当前步骤序号和总步骤数

#### Scenario: 步骤完成时报告结果
- **WHEN** 一个契约点的测试执行完成
- **THEN** 输出该步骤的结果（✓ 通过 / ✗ 失败）和关键数据（用例数、轮次）
- **THEN** 不输出完整构建日志或测试详细输出

#### Scenario: 失败后展示诊断与修复
- **WHEN** 测试失败需要修复
- **THEN** 在结果行后输出一行诊断摘要
- **THEN** 修复完成后输出重新测试结果和当前轮次

### Requirement: 报告结论先行
Harden Report SHALL 在第一行呈现总体结论（PASSED/PARTIAL/FAILED）和关键数字，详细结果表格在结论之后按需查阅。

#### Scenario: 报告首行展示结论
- **WHEN** 系统输出 Harden Report
- **THEN** 第一行显示总体状态（✓ 通过 / △ 部分通过 / ✗ 失败）
- **THEN** 第一行包含自动测试通过数/总数、E2E 通过数/总数、执行轮次
- **THEN** 第一行包含待处理手动验证项数量

#### Scenario: 报告详情精简呈现
- **WHEN** 用户需要查看详情
- **THEN** 每个契约点用单行展示（名称 + 测试方法 + 结果 + 轮次）
- **THEN** 不再展示冗余的默认配置信息（如 "Max retry: 3 (default)"）

### Requirement: SKILL.md 瘦身为路由索引
`openspec-test-reinforce/SKILL.md` SHALL 只保留技能元信息（frontmatter）和入口指向，所有执行逻辑、Prompt 约束、输出模板 SHALL 收敛到 `harden.md`。

#### Scenario: SKILL.md 最小化
- **WHEN** 查看 SKILL.md
- **THEN** 文件包含有效 frontmatter（name, description, license, compatibility, metadata）
- **THEN** 文件正文只说明该技能由 `/opsx:harden` 触发，所有逻辑见 harden.md
- **THEN** 不包含任何 Phase、Steps、Guardrails、输出模板等业务逻辑

#### Scenario: harden.md 作为 SSOT
- **WHEN** 需要修改 harden 工作流行为
- **THEN** 只需修改 `harden.md`，无需同步修改 SKILL.md
- **THEN** harden.md 包含完整的 Phase 定义、输出模板、Guardrails 约束

### Requirement: BLOCKED 输出情境化
当 Execute 阶段遇到 BLOCKED 状态时，系统 SHALL 只列出对当前情境合理的选项，不再展示模板化的固定四选一。

#### Scenario: 环境阻塞只提供相关选项
- **WHEN** 因环境问题（缺少依赖、网络不通）触发 BLOCKED
- **THEN** 输出阻塞原因和详情
- **THEN** 只列出合理选项（如 "检查环境后重试" "跳过该项继续" "中止 harden"）
- **THEN** 不显示无关选项（如 "调整范围重试"）

#### Scenario: 超出范围阻塞
- **WHEN** 因修复超出确认范围触发 BLOCKED
- **THEN** 只列出 "调整范围后重试" "跳过该项继续" "中止 harden"
- **THEN** 不显示 "检查环境" 等无关选项
