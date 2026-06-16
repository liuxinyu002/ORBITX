---
name: "OPSX: Review"
description: Review change artifacts across 6 quality dimensions before implementation
category: Workflow
tags: [workflow, review]
---

Review an OpenSpec change proposal across 6 quality dimensions.

**Input**: Optionally specify a change name (e.g., `/opsx:review phase-4`). If omitted, auto-detect the active change. If ambiguous, prompt the user for selection.

## Steps

### 1. Select the change

If a name is provided, use it. Otherwise:
- Scan `openspec/changes/` excluding `archive/`
- If exactly one active change exists, auto-select it
- If multiple active changes exist, present a candidate list and let the user choose:
  ```
  检测到多个活跃变更，请指定要评审的变更：
  1. <change-name> — <最近修改时间> — <一句话摘要（取自 proposal Why/What Changes）>
  2. <change-name> — <最近修改时间> — <一句话摘要>
  ...
  ```
- Announce: "**评审变更**: <change-name>"

### 2. Read artifacts

Read all artifacts for the selected change:
- `openspec/changes/<name>/proposal.md`
- `openspec/changes/<name>/design.md`
- `openspec/changes/<name>/specs/**/*.md`
- `openspec/changes/<name>/tasks.md`

### 3. Execute 6-dimension review

Evaluate the change against all 6 dimensions. Each dimension produces zero or more findings, each graded with exactly one severity level.

**Severity Definitions:**

| Grade | Icon | Criteria |
|-------|------|----------|
| Blocker | 🔴 | Violates a hard engineering constraint or core architectural boundary. MUST be fixed before implementation. Includes: breaking project network isolation, corrupting data safety boundaries, unresolvable task dependency chains, missing required capability permissions, unsafe resource handling, version-less or known-vulnerable dependencies. |
| Should Fix | 🟡 | Clear quality, performance, or maintainability risk. SHOULD be addressed before implementation. Includes: N+1 query pattern, blocking UI modal, missing error state, missing dark mode coverage, missing key-path logging, hardcoded configuration without env fallback. |
| Suggestion | 🔵 | Optimization opportunity with no immediate risk. Includes: suboptimal information density, wording inconsistency, minor layout optimization. |

**6 Review Dimensions:**

#### Dimension 1: 执行审核 (Execution Review)

Check task dependency chains, file paths, cross-change conflicts, capability permissions, and non-goal scope creep.

- Does every task dependency form a valid DAG (no circular dependency, parent task listed before child)?
- Do all file paths referenced in tasks exist in the repository?
- Are there conflicts with other active changes under `openspec/changes/`?
- Do all tasks respect the non-goal constraints declared in proposal? (severity: 🔴 if task violates a non-goal)
- Are required permissions/capabilities declared in the proposal's Impact section?
- If proposal mentions Tauri capabilities, are they declared in `capabilities/`?

#### Dimension 2: UI审核 (UI Review)

Only applicable if the change involves UI work. Check DESIGN.md compliance, component state coverage, and visual consistency.

- Does the design reference the project's DESIGN.md? If DESIGN.md exists and the change involves UI but doesn't reference it → 🟡
- Are component states covered: default, hover, focus, active, disabled, loading? (🟡 if interactive components lack state documentation)
- Is dark mode coverage addressed? (🟡 for UI changes without dark mode consideration)
- Does the design respect the accent color 5% rule? (🟡 if accent color usage is undocumented)
- Skeleton vs spinner: for data-loading components, does the design specify which to use? (🔵 if unspecified)
- Information density: does the UI layout meet information density standards? (🔵 for suboptimal density)

#### Dimension 3: 架构审核 (Architecture Review)

Check N+1 risks, transaction boundaries, hardcoded configuration, module boundaries, controller bloat, data model extensibility, async isolation, error mapping.

- Are there N+1 query patterns? Look for loops containing database/API calls → 🟡
- Are large transactions possible? Look for unbounded writes without batching → 🟡
- Is there hardcoded configuration? Values that should be in config/env but are inline → 🟡
- Are module boundaries violated? Backend code importing from frontend or vice versa → 🔴
- Controller/handler bloat: single handler/functions with too many responsibilities → 🟡
- Data model extensibility: are new data types designed with future evolution in mind? → 🔵
- Async isolation: are async boundaries explicit and correct? → 🔴 if async/blocking mix is unsafe
- Error mapping: are all error cases mapped to appropriate user-facing messages? → 🟡

#### Dimension 4: 韧性审核 (Resilience Review)

Check timeout strategies, input validation, permission degradation, single points of failure, resource cleanup, retry/backoff.

- External dependency timeout: do all network/external calls define timeouts? → 🟡 (🔴 if critical path lacks timeout)
- Input validation: are thresholds/boundaries validated at system entry points? → 🟡
- Permission failure degradation: does the system degrade gracefully when permissions are missing? → 🟡
- Single point of failure: are there any SPOFs in the proposed architecture? → 🔴
- Resource cleanup: is RAII/cleanup guaranteed for acquired resources (file handles, connections)? → 🟡
- Retry backoff: for transient-failure-prone operations, is there a retry strategy? → 🔵

#### Dimension 5: 可观测性审核 (Observability Review)

Check log coverage, error states, module naming, performance metrics, frontend console.log violations.

- Key path log coverage: do critical code paths have log points? → 🟡 (🔴 if zero log coverage on critical paths)
- Log language: are proposed log messages in Chinese? (per project CLAUDE.md requirement) → 🟡
- User-visible error states: are all error conditions surfaced to users with clear messages? → 🟡
- Module `target` naming: do log targets use consistent module identifiers? → 🔵
- Performance metrics: are performance-sensitive paths instrumented? → 🔵
- Frontend `console.log` violations: does the change add raw `console.log` instead of using the `log()` bridge? → 🟡

#### Dimension 6: 依赖与供应链审核 (Dependency & Supply Chain Review)

Check version pinning, vulnerability exposure, platform conditional compilation, necessity assessment, license compatibility.

- Exact version pinning: are new dependencies pinned to exact versions (not `^` or `~`)? → 🔴 if unpinned
- Known vulnerabilities: do new dependencies have known CVEs? → 🔴 if known vulnerability exists
- Platform conditional compilation: are platform-specific dependencies correctly gated (e.g., `[target.'cfg(target_os = "macos")'.dependencies]`)? → 🟡
- Necessity: is each new dependency genuinely needed, or could existing deps serve the purpose? → 🔵
- License compatibility: are new dependency licenses compatible with the project's license? → 🟡

### 4. Generate review report

**Format rules:**
- Begin with a global summary line
- Only expand dimensions that have findings
- Passed dimensions are NOT rendered as sections; their count appears only in the summary
- All findings formatted as Markdown checklist items with severity prefix: `- [ ] <severity> <description>`
- Every 🔴 Blocker and 🟡 Should Fix MUST include a **修复建议** section with a fix suggestion
- 🔵 Suggestion MAY include a brief textual recommendation without a mandatory code block
- Fix suggestions MUST be one of: configuration fragment, architecture pseudocode, or schema change description
- Fix suggestions MUST NOT contain: complete function bodies, frontend JSX/TSX, production-ready business logic

**Report template:**

```
## 审查报告: <change-name>

**诊断完成：发现 X 个 Blocker，Y 个 Warning，Z 个维度通过。当前状态：🔴 需修正 / 🟢 可继续**

**下一步**：<授权我修正方案 / 仅修复 Blocker / 修复 Blocker + Warning / 逐条确认 / 仅保留诊断>

### <维度名>（N <severity>）

- [ ] <severity> <检查项描述>

**修复建议**：
```<lang>
<方案级代码/配置/伪代码>
```

- [ ] <severity> <检查项描述>
...
```

**Global summary rules:**
- If any Blocker exists → status is `🔴 需修正`
- If zero Blockers → status is `🟢 可继续` (regardless of Warning/Suggestion counts)
- Summary format: `诊断完成：发现 X 个 Blocker，Y 个 Warning，Z 个维度通过。当前状态：<🔴 需修正 / 🟢 可继续>`
- Z = number of dimensions with zero findings

**Next-step action format:**
- If Blockers exist: `**下一步**：授权我修正方案 / 仅修复 Blocker / 修复 Blocker + Warning / 逐条确认 / 仅保留诊断`
- If no Blockers but Warnings exist: `**下一步**：继续 apply / 修复 Warning / 仅保留诊断`
- If all pass: `**下一步**：可以继续 apply`

### 5. Handle authorization

**CRITICAL: By default, the review engine is READ-ONLY. Do NOT modify any artifact files unless the user explicitly authorizes it.**

After outputting the report, present the authorization options clearly. Wait for the user's explicit choice.

#### 5a. If user chooses to keep diagnosis only (default):
Exit without modifying any files. Do NOT create `review.md` or any other state file.

#### 5b. If user authorizes fix application:

**Step 1: Show modification preview**

Before touching any file, output a preview:

```
## 修改预览

### 拟修改文件
- `openspec/changes/<name>/proposal.md` — 补充缺失的能力权限声明
- `openspec/changes/<name>/design.md` — 修正 N+1 查询模式，增加超时策略
- `openspec/changes/<name>/tasks.md` — 新增韧性验证任务

### 修改摘要
| 文件 | 对应问题 | 修改内容 |
|------|----------|----------|
| proposal.md | [Blocker] 缺少权限声明 | 在 Impact 段添加 capabilities 声明 |
| design.md | [Warning] N+1 查询 | 在 Decisions 段添加批量查询方案 |
| design.md | [Warning] 缺少超时 | 在 Risks 段添加超时时间配置 |
```

**Step 2: Ask user to select scope**

Present scope options and wait for user selection:

1. **仅修复 Blocker** — Only apply fixes for 🔴 Blocker findings
2. **修复 Blocker + Warning** — Apply fixes for 🔴 Blocker and 🟡 Should Fix findings
3. **逐条确认** — Present each candidate fix individually; apply only those explicitly confirmed
4. **取消** — Keep diagnosis only, no file changes

#### 5c. Apply authorized fixes

Based on the selected scope, modify only the relevant artifact files:
- `openspec/changes/<name>/proposal.md`
- `openspec/changes/<name>/design.md`
- `openspec/changes/<name>/tasks.md`
- `openspec/changes/<name>/specs/**/*.md`

Each fix must be the minimum viable change — do not rewrite unrelated content.

**Write constraints:**
- Do NOT create `review.md` or any intermediate state file
- Do NOT modify `.claude/skills/openspec-apply-change/SKILL.md`
- Do NOT modify files outside `openspec/changes/<name>/`
- Do NOT modify files without explicit user authorization

#### 5d. Output change receipt

After completing authorized modifications, output a change receipt:

```
## 变更回执

### 已修改文件
- `proposal.md` — 补充了能力权限声明
- `design.md` — 修正了 N+1 查询模式，添加了批量查询方案

### 已解决问题
- [Blocker] 缺少权限声明 → 已在 proposal.md Impact 段添加
- [Warning] N+1 查询 → 已在 design.md 添加批量查询决策

### 未修改问题
- [Suggestion] 信息密度优化 — 按选择范围保留

方案已更新，可继续 `/opsx:apply`。
```

## Guardrails

- **Must not skip dimensions.** All 6 dimensions must be evaluated regardless of findings in earlier dimensions.
- **Read-only by default.** Never modify files without explicit user authorization.
- **Preview before modifying.** Always show what will change before making any modifications.
- **Minimum viable fixes.** Each fix should be the smallest change that addresses the issue — don't rewrite unrelated content.
- **No review state file.** Never create `review.md` or similar intermediate files. Fixes go directly to source artifacts.
- **Erring on the side of reporting.** When uncertain about severity, prefer Warning over silence: "宁可多报 Warning，不可漏报 Blocker".
- **Respect existing artifacts.** Don't modify `/opsx:apply` skill or other OpenSpec infrastructure.
- **Fix granularity.** Fix suggestions must stay at proposal/schema/config level — no business logic code.
