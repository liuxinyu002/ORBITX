## Why

当前 OpenSpec 工作流在 `/opsx:propose` 产出方案后直接进入 `/opsx:apply` 实施阶段，缺少一道质量闸门。方案的架构缺陷、UI 规范冲突、依赖风险、韧性缺失等问题只能在实施中或实施后暴露，发现越晚修复成本越高。需要在 propose 和 apply 之间插入一个结构化的方案评审命令，在"图纸阶段"拦截问题。

## What Changes

- 新增 `/opsx:review` slash 命令，作为 propose 后、apply 前的质量闸门
- 命令自动检测当前活跃变更（或接受显式变更名），在多变更场景下展示带摘要的候选列表
- 以 6 个审核维度（执行/UI/架构/韧性/可观测性/依赖供应链）对方案进行结构化审查
- 默认输出结构化分级检查清单（🔴 Blocker / 🟡 Should Fix / 🔵 Suggestion），仅展开有问题的维度，并在摘要区给出下一步动作提示
- 经用户明确授权后，先展示“拟修改文件 + 修改摘要”，再按用户选定范围将最小修复建议回写到 proposal/design/specs/tasks 原文件
- 授权支持 3 种粒度：仅修复 Blocker、修复 Blocker + Warning、逐条确认
- 修复建议限制在方案级（配置片段/架构伪代码/Schema 变更描述），严禁输出业务逻辑代码

## Capabilities

### New Capabilities

- `review-engine`: 方案评审引擎。读取变更产物，按 6 维度逐项审查，输出带下一步动作提示的分级检查清单；在得到用户授权后，先预览拟修改内容，再将最小修复建议按选定粒度写回对应方案文件。

## Impact

- 新增 `.claude/skills/openspec-review/SKILL.md`：评审命令的完整系统提示词
- `/opsx:review` 默认只输出诊断结果，不新增中间状态文件
- 诊断摘要需同时展示：Blocker/Warning 数量、通过维度数量、建议的下一步动作
- 用户授权后，直接修改 `openspec/changes/<name>/` 下的 proposal/design/specs/tasks 原文件
- 不涉及 OrbitX 应用代码变更，纯工具链改进
