## 1. 重写 harden.md 交互流程

- [x] 1.1 合并 Phase 2+3 为 "Phase 2: Harden Assessment"——Review 与 Plan 合并输出，只设一个用户决策点
- [x] 1.2 实现摘要优先输出模板——风险计数 + 涉及模块 + 验证范围概要 + 一行执行计划
- [x] 1.3 实现按需展开机制——用户输入 "详情" 才输出完整契约点映射表和 Not In Scope 分类
- [x] 1.4 重写 Phase 4 Execute——每步增加 `[N/M]` 心跳反馈，包含开始/结果/诊断行
- [x] 1.5 重写 Phase 5 Report——结论先行，详情精简为单行/契约点，去除默认配置展示
- [x] 1.6 精简 BLOCKED 输出模板——根据阻塞类型只列合理选项，去掉固定四选一
- [x] 1.7 更新 Guardrails 节——反映新的交互约束（摘要优先、心跳反馈、SKILL.md 瘦身）

## 2. 精简 SKILL.md

- [x] 2.1 移除 SKILL.md 中的 Phase/Steps/Guardrails/输出模板等业务逻辑
- [x] 2.2 保留 frontmatter 元信息，正文改为入口指向（指向 harden.md）

## 3. 验证

- [x] 3.1 确认 harden.md 和 SKILL.md 无逻辑漂移——SKILL.md 不包含任何 harden.md 未覆盖的约束
- [x] 3.2 用 `openspec/changes/archive/2026-06-21-add-toast-overlay` 跑一次 `/opsx:harden`，验证新交互流程符合 spec
