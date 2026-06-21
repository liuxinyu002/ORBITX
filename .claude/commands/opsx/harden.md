---
name: "OPSX: Harden"
description: Test hardening for an OpenSpec change — Review → Plan → Execute → Report
category: Workflow
tags: [workflow, testing, experimental]
---

Test hardening for an OpenSpec change. Invoked as `/opsx:harden [change-name]`.

**Input**: Optionally specify a change name (e.g., `/opsx:harden add-auth`). If omitted, infer from conversation context, auto-select if only one active change exists, or prompt user to choose from `openspec list --json`.

Always announce: "Using change: <name>" and how to override (e.g., `/opsx:harden <other>`).

## Overview

`/opsx:harden` is an optional, on-demand test reinforcement workflow. It is **contract-point driven** (not task-checkbox driven). The internal workflow is:

```
Assessment → (user confirms) → Execute (test → run → fix → retry) → Report
```

**Guiding principles:**
- Focus on risk, not coverage metrics
- Only test core computation, boundary conditions, concurrency, and security-critical paths
- Skip pure CRUD pass-through, UI styles, and glue code
- No complex mocks, no refactoring during harden
- E2E defaults to Playwright, Happy Path only
- Terminal report is the only result carrier — do NOT write back to change artifacts

## Phase 1: Select the Change

1. If a change name is provided, use it.
2. Otherwise infer from conversation context.
3. Auto-select if only one active change exists (`openspec list --json`).
4. If ambiguous, use **AskUserQuestion** to let the user select.

Run `openspec status --change "<name>" --json` to confirm the change exists and read its schema.

## Phase 2: Harden Assessment

**Goal**: Review contract points, classify risks, define verification scope, and present a single decision point.

### Steps

1. **Read all artifacts** for the change:
   - `proposal.md` — understand what changed and why
   - `design.md` — understand architectural decisions and trade-offs
   - `specs/**/*.md` — extract contract points, boundary conditions, exception scenarios
   - `tasks.md` — understand implementation scope (but do NOT organize review by tasks)

2. **Extract contract points** from specs:
   - Identify every requirement marked as "契约点" or "contract point"
   - For each contract point, note: expected behavior, boundary conditions, error paths
   - Also infer implicit contract points: any business rule, data validation, state transition, or concurrency control described in specs that is not explicitly labeled

3. **Map contracts to implementation**:
   - For each contract point, find the corresponding implementation code
   - Check if existing tests already cover this contract point
   - Identify gaps: untested contracts, missing boundary cases, missing error paths

4. **Classify risks** using three levels:

   | Level | Criteria | Action |
   |-------|----------|--------|
   | **CRITICAL** | Implementation deviates from artifacts AND fixing would change behavior or scope; OR core security/data-integrity path with zero test coverage | **STOP** — do not proceed to decision point |
   | **WARNING** | Missing boundary/error-path tests; concurrency not covered; regression risk in related modules | Include in scope |
   | **NOTE** | Minor gaps; test clarity improvements; non-critical edge cases | Include in scope as optional |

5. **Define verification scope**:
   - `Contracts In Scope`: contract points that will be verified, with verification method
   - `Not In Scope`: contract points explicitly excluded, with reason from these categories:
     - `New Feature Expansion` — would require implementing new features
     - `Large Refactor` — would require restructuring code
     - `Test Infrastructure Buildout` — would require building complex test infrastructure
     - `Non-critical UI / E2E Expansion` — beyond Happy Path E2E
     - `External Environment / Integration Issues` — depends on unavailable services

6. **Assign verification method** to each in-scope contract point:
   - `Automated` — unit/integration test that runs without external dependencies
   - `E2E` — Playwright (frontend) or equivalent end-to-end test, Happy Path only
   - `Manual` — requires human verification; MUST use state transition matrix format

7. **Manual verification items** MUST use this format (state transition matrix):

   | 初始状态 | 操作 | 预期状态变化 |
   |---------|------|-------------|
   | <pre-condition state> | <action> | <expected observable state change> |

   - Do NOT use UI-click descriptions ("点击按钮，看到弹窗")
   - Expected state change must describe observable business state, data state, or system response

8. **Declare retry configuration**: Default max 3 retry rounds. A "round" = `run tests → diagnose failures → fix → re-run`.

### Output: Summary-First Template

**If CRITICAL risks exist**, output the CRITICAL items and stop — do NOT show the decision point:

```
## Harden Assessment — <change-name>

### ⚠ CRITICAL 风险

| # | Contract | Issue | Recommendation |
|---|----------|-------|----------------|
| 1 | CP-<n> | <description> | <action> |

请先处理上述 CRITICAL 风险后再继续。
```

**If no CRITICAL risks**, output the summary:

```
## Harden Assessment — <change-name>

### 风险评估
- CRITICAL: 0 · WARNING: <N> · NOTE: <N>
- 涉及模块: <module list>
- 验证范围: 自动 <N> / E2E <N> / 手动 <N>
- 执行计划: 最多 <N> 轮重试

---

**是否继续？** 回复 "yes" / "确认" 开始执行。输入 "详情" 查看完整契约点映射表和 Not In Scope 分类。
```

### Drill-Down: 按需展开

When the user inputs "详情" or "details", output the full tables:

```
### 契约点映射

| # | Contract Point | Source | Implementation | Existing Tests | Risk |
|---|---------------|--------|----------------|----------------|------|
| 1 | <description> | spec.md:L12 | src/foo.ts:34 | None | WARNING |

### Not In Scope

| # | Contract Point | Category | Reason |
|---|---------------|----------|--------|
| 4 | CP-4: <desc> | Non-critical UI / E2E Expansion | <why> |

### Manual Verification Required

| 初始状态 | 操作 | 预期状态变化 |
|---------|------|-------------|
| <state> | <action> | <expected change> |

---

**是否继续？** 回复 "yes" / "确认" 开始执行。
```

### Decision Point

**Wait for user confirmation.** Do NOT proceed to Execute until the user explicitly confirms. Confirmation authorizes:
- Automatic test writing within the defined scope
- Automatic test execution
- Automatic code fixes (test or implementation) within scope
- Up to the declared max retry rounds

## Phase 3: Execute

**Prerequisite**: User has explicitly confirmed the Harden Assessment.

**For each contract point**, output `[N/M]` heartbeat at start and completion:

```
[N/M] 正在验证 <contract point 简述>...
[N/M] ✓ 通过 (<N> 用例)
```

Or on failure:

```
[N/M] ✗ 失败 — <failure summary>
[N/M] 诊断: <diagnosis>
```

### Steps

1. **Write/Supplement tests** for each Automated contract point:
   - Follow existing project test conventions (framework, directory structure, naming)
   - Each test MUST map to a specific contract point
   - Include boundary condition and error path cases per the spec
   - Keep tests minimal: no complex mocks, no new test infrastructure
   - If a module is pure CRUD/glue code, explicitly skip it with heartbeat `[N/M] 跳过 <reason>`

2. **Run tests** using the project's test commands.

3. **Diagnose failures** (if any):
   - **Implementation defect** → fix the implementation code (within scope)
   - **Test defect** (test is wrong, implementation is correct) → fix the test
   - **Environment issue** (missing dependency, config, network) → **STOP** as BLOCKED
   - **Artifact deviation** (implementation differs from spec/design, and fixing changes behavior) → **STOP** as `WAITING_FOR_CONFIRMATION`
   - **Out of scope** (fix requires changes beyond the confirmed scope) → **STOP** as BLOCKED

4. **Retry loop**: After each fix, re-run tests. Output retry heartbeat:
   ```
   [N/M] 第 <R> 轮重试...
   [N/M] ✓ 通过 (<N> 用例)
   ```
   Continue until:
   - All tests pass → proceed to Report
   - Max retry rounds reached → **STOP** as BLOCKED
   - A stop condition triggers → **STOP**

5. **For E2E** contract points: Write minimal Playwright (or project-conventional E2E) tests covering Happy Path only. Run and include in the retry loop.

6. **For Manual** contract points: Do NOT execute anything. They will appear in the Report as `PENDING`.

### Stop Conditions

| Condition | State | Behavior |
|-----------|-------|----------|
| Implementation deviates from artifacts, fix would change behavior/scope | `WAITING_FOR_CONFIRMATION` | Stop, explain deviation, wait for user decision |
| Environment blocking (missing dep, config, network, db) | `BLOCKED` | Stop, describe the environment issue |
| Out of scope (fix requires changes beyond confirmed scope) | `BLOCKED` | Stop, describe what's out of scope |
| Max retry rounds exceeded (default 3) | `BLOCKED` | Stop, summarize what failed and what was tried |

### BLOCKED Output

When BLOCKED, output based on the blocking type — only show relevant options:

```
## Harden BLOCKED — <change-name>

**原因**: <blocking category>
**详情**: <specific description>
**已执行轮次**: N
**最后失败**: <test name / error summary>
```

**Environment blocking** (missing dep, config, network):

```
**选项:**
1. 检查环境后重试
2. 跳过该项继续
3. 中止 harden
```

**Out of scope / max retries exceeded**:

```
**选项:**
1. 调整范围后重试
2. 跳过该项继续
3. 中止 harden
```

## Phase 4: Harden Report

**Goal**: Output the final result, conclusion-first.

### Output: Conclusion-First Template

```
## Harden 完成 — <change-name>

### 结果: <✓ 通过 / △ 部分通过 / ✗ 失败> (自动 <passed>/<total>, E2E <passed>/<total>) · <N> 轮 · <N> 待处理
```

### Detail: Per-Contract-Point Summary (Single Line)

| # | Contract Point | Method | Result | 轮次 |
|---|---------------|--------|--------|------|
| 1 | CP-1: <desc> | Automated | ✓ | 1 |
| 2 | CP-2: <desc> | E2E | ✓ | 2 |
| 3 | CP-3: <desc> | Manual | PENDING | — |

### Manual Verification Pending

| 初始状态 | 操作 | 预期状态变化 | Status |
|---------|------|-------------|--------|
| <state> | <action> | <expected> | PENDING |

### Uncovered Contracts

| # | Contract Point | Reason |
|---|---------------|--------|
| 4 | CP-4 | Non-critical UI expansion — suggest `/opsx:explore` for follow-up |

### Final Status: <PASSED / PARTIAL / FAILED>
```

### Post-Report Manual Verification

If there are PENDING manual items, prompt:
- "请对以下手动验证项提供反馈（例: '项1: 通过, 项2: 失败 — <原因>'）。回复 'skip' 保留 PENDING 状态。"

Process user feedback: update item statuses. Status cannot be `PASSED` while any manual item remains `PENDING`.

### Steps

1. **Compile results** across all three verification categories: Automated, E2E, Manual
2. **Output conclusion-first**: first line shows overall status and key numbers
3. **Per-contract-point detail**: single-line summary for each contract point
4. **Manual items**: state transition matrix items with status, prompt for feedback
5. **Uncovered contracts**: not-verified contract points with reasons. Do NOT write back to tasks.md, design.md, or any artifact. Suggest `/opsx:explore` for follow-up.

## Guardrails

- **摘要优先**: 顶层只输出核心状态和决策点，详细数据按需展开
- **心跳反馈**: Execute 阶段每步输出 `[N/M]` 进度标记
- **SKILL.md 瘦身**: 所有业务逻辑在 harden.md，SKILL.md 仅为路由索引
- Contract-point driven: organize by contracts, not by task checkboxes
- Do NOT write back to change artifacts (tasks.md, design.md, specs)
- Terminal report is the only result carrier
- No refactoring: only fix code to make tests pass, do not "clean up" or "improve" unrelated code
- Skip simple logic: if a module is pure CRUD/glue, explicitly mark "跳过" and do not test
- No complex mocks: keep test infrastructure minimal
- Manual checklists MUST use state transition matrix format (| 初始状态 | 操作 | 预期状态变化 |)
- E2E defaults to Playwright, Happy Path only
- Default max 3 retry rounds; user can override at Assessment confirmation
- If execution reveals artifact deviation, STOP and wait — do not silently change scope
- Uncovered contracts should suggest `/opsx:explore` for follow-up, not pollute artifacts
- CRITICAL 风险时在评估阶段阻断，不进入决策点
