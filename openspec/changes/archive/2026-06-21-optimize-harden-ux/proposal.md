## Why

`/opsx:harden` 当前的交互体验像一个日志输出机而非协作 Agent——Review 和 Plan 阶段连续输出大量表格，将用户决策点 `Confirm?` 挤出视野；Execute 阶段是黑盒；最终报告 6 张表格信息过载。需要在顶层只暴露核心状态与决策点，让用户焦点回到真正需要判断的内容上。

## What Changes

- **合并 Review + Plan 为单一 "评估与计划" 阶段**：去除无 CRITICAL 时的中间打断，输出压缩为风险评估摘要 + 一行执行计划 + 一个决策点
- **表格输出改为摘要 + 按需展开**：顶层只显示风险计数、模块列表、验证范围概要。用户输入 "详情" 才展开完整映射表
- **Execute 阶段增加心跳反馈**：每步输出 `[N/M]` 进度标记和当前状态，打破黑盒等待
- **最终报告结论先行**：第一行给出总体结果，详情按需查看，去除非必要的默认值展示
- **SKILL.md 瘦身为路由索引**：所有业务逻辑收敛到 harden.md，SKILL.md 只保留技能元信息和入口指向
- **BLOCKED 输出精简**：只列当前情境合理的选项，去掉模板化四选一

## Capabilities

### New Capabilities

- `harden-interaction`: 定义 harden 技能的交互模式——摘要优先、按需展开、心跳反馈、结论先行

### Modified Capabilities

None. 现有 specs 均不涉及 harden 工作流。

## Impact

- `.claude/commands/opsx/harden.md` — 重写交互流程、输出模板、反馈机制
- `.claude/skills/openspec-test-reinforce/SKILL.md` — 精简为路由索引
