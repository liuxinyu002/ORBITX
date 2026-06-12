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
Review → Plan → (user confirms) → Execute (test → run → fix → retry) → Report
```

Terminal output is structured into three segments: **Harden Review**, **Harden Plan**, **Harden Report**.

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

## Phase 2: Harden Review

**Goal**: Extract contract points from artifacts, review related implementation and existing tests, output a risk report.

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
   | **CRITICAL** | Implementation deviates from artifacts AND fixing would change behavior or scope; OR core security/data-integrity path with zero test coverage | **STOP** and enter `WAITING_FOR_CONFIRMATION` |
   | **WARNING** | Missing boundary/error-path tests; concurrency not covered; regression risk in related modules | Include in Plan, recommend action |
   | **NOTE** | Minor gaps; test clarity improvements; non-critical edge cases | Include in Plan as optional |

5. **Output `Harden Review`** to terminal:

```
## Harden Review — <change-name>

### Contract Points Extracted
| # | Contract Point | Source | Implementation | Existing Tests |
|---|---------------|--------|----------------|----------------|
| 1 | <description> | spec.md:L12 | src/foo.ts:34 | None / test/foo.test.ts:56 |

### Risk Report
| Level | Contract | Issue | Recommendation |
|-------|----------|-------|----------------|
| CRITICAL | CP-1 | <description> | <action> |
| WARNING | CP-2 | <description> | <action> |
| NOTE | CP-3 | <description> | <action> |
```

If any CRITICAL risk triggers the stop condition, pause and wait for user guidance before proceeding.

## Phase 3: Harden Plan

**Goal**: Generate a verification plan scoped by contract points, for user confirmation.

**Prerequisite**: Review completed without unresolved CRITICAL risks (or user overrode them).

### Steps

1. **Define scope**:
   - `Contracts In Scope`: contract points that will be verified, with verification method
   - `Not In Scope`: contract points explicitly excluded, with reason from these categories:
     - `New Feature Expansion` — would require implementing new features
     - `Large Refactor` — would require restructuring code
     - `Test Infrastructure Buildout` — would require building complex test infrastructure
     - `Non-critical UI / E2E Expansion` — beyond Happy Path E2E
     - `External Environment / Integration Issues` — depends on unavailable services

2. **Assign verification method** to each in-scope contract point:
   - `Automated` — unit/integration test that runs without external dependencies
   - `E2E` — Playwright (frontend) or equivalent end-to-end test, Happy Path only
   - `Manual` — requires human verification; MUST use state transition matrix format

3. **Manual verification items** MUST use this format (state transition matrix):

   | 初始状态 | 操作 | 预期状态变化 |
   |---------|------|-------------|
   | <pre-condition state> | <action> | <expected observable state change> |

   - Do NOT use UI-click descriptions ("点击按钮，看到弹窗")
   - Expected state change must describe observable business state, data state, or system response
   - Only items requiring actual human participation go into the manual list

4. **Summarize test commands** that will be executed:
   - Command category (e.g., `pytest`, `npm test`, `playwright`, `go test`)
   - Scope (which files/test suites)
   - Expected coverage of contract points

5. **Declare retry configuration**: Default max 3 retry rounds. A "round" = `run tests → diagnose failures → fix → re-run`. User may override.

6. **Output `Harden Plan`** to terminal:

```
## Harden Plan — <change-name>

### Contracts In Scope
| # | Contract Point | Method | Rationale |
|---|---------------|--------|-----------|
| 1 | CP-1: <desc> | Automated | <why> |
| 2 | CP-2: <desc> | E2E | <why> |
| 3 | CP-3: <desc> | Manual | <why> |

### Not In Scope
| # | Contract Point | Category | Reason |
|---|---------------|----------|--------|
| 4 | CP-4: <desc> | Non-critical UI / E2E Expansion | <why> |

### Test Command Summary
| Command | Scope | Covers |
|---------|-------|--------|
| pytest tests/unit/ | Unit tests for core logic | CP-1 |
| playwright test e2e/ | Happy Path E2E | CP-2 |

### Manual Verification Required
| 初始状态 | 操作 | 预期状态变化 |
|---------|------|-------------|
| <state> | <action> | <expected change> |

### Configuration
- Max retry rounds: 3 (default)
- Auto-fix within scope: Yes
- Stop on artifact deviation: Yes

---

**Confirm?** Reply "yes" / "proceed" / "确认" to authorize automatic execution within this scope. Reply with modifications to adjust scope.
```

7. **Wait for user confirmation**. Do NOT proceed to Execute until the user explicitly confirms. Confirmation authorizes:
   - Automatic test writing within the defined scope
   - Automatic test execution
   - Automatic code fixes (test or implementation) within scope
   - Up to the declared max retry rounds

## Phase 4: Execute

**Prerequisite**: User has explicitly confirmed the Harden Plan.

### Steps

1. **Write/Supplement tests** for each Automated contract point:
   - Follow existing project test conventions (framework, directory structure, naming)
   - Each test MUST map to a specific contract point
   - Include boundary condition and error path cases per the spec
   - Keep tests minimal: no complex mocks, no new test infrastructure
   - If a module is pure CRUD/glue code, explicitly skip it and note why

2. **Run tests** using the project's test commands.

3. **Diagnose failures** (if any):
   - **Implementation defect** → fix the implementation code (within scope)
   - **Test defect** (test is wrong, implementation is correct) → fix the test
   - **Environment issue** (missing dependency, config, network) → **STOP** as BLOCKED
   - **Artifact deviation** (implementation differs from spec/design, and fixing changes behavior) → **STOP** as `WAITING_FOR_CONFIRMATION`
   - **Out of scope** (fix requires changes beyond the confirmed scope) → **STOP** as BLOCKED

4. **Retry loop**: After each fix, re-run tests. One round = `run → diagnose → fix → re-run`. Continue until:
   - All tests pass → proceed to Report
   - Max retry rounds reached → **STOP** as BLOCKED
   - A stop condition triggers → **STOP**

5. **For E2E** contract points: Write minimal Playwright (or project-conventional E2E) tests covering Happy Path only. Run and include in the retry loop.

6. **For Manual** contract points: Do NOT execute anything. They will appear in the Report as `PENDING` awaiting user feedback.

### Stop Conditions (in priority order)

| Condition | State | Behavior |
|-----------|-------|----------|
| Implementation deviates from artifacts, fix would change behavior/scope | `WAITING_FOR_CONFIRMATION` | Stop, explain deviation, wait for user decision |
| Environment blocking (missing dep, config, network, db) | `BLOCKED` | Stop, describe the environment issue |
| Out of scope (fix requires changes beyond confirmed scope) | `BLOCKED` | Stop, describe what's out of scope |
| Max retry rounds exceeded (default 3) | `BLOCKED` | Stop, summarize what failed and what was tried |

When BLOCKED, output:
```
## Harden BLOCKED — <change-name>

**Reason**: <reason category from table above>
**Details**: <specific description>
**Rounds executed**: N
**Last failure**: <test name / error summary>

**Options:**
1. Adjust scope and retry
2. Investigate environment / dependencies
3. Accept partial results and proceed to Report
4. Abort harden

What would you like to do?
```

## Phase 5: Harden Report

**Goal**: Output the final structured report summarizing all results.

### Steps

1. **Compile results** across all three verification categories:
   - `Automated Results`: passed/failed counts, which contract points are covered
   - `E2E Results`: passed/failed, Happy Path coverage
   - `Manual Verification Required`: state transition matrix items with status

2. **Track manual verification status**:
   - Each manual item is initially `PENDING`
   - User may provide feedback item by item or in batch
   - Status: `PASSED`, `FAILED`, or `PENDING`
   - If user feedback cannot be mapped to a specific item, unmapped items stay `PENDING`
   - Final status cannot be `PASSED` while any manual item remains `PENDING`

3. **List covered and uncovered contract points**:
   - `Covered Contracts`: contract points with passing verification
   - `Uncovered Contracts`: contract points not verified, each with a reason
   - Do NOT write uncovered contracts back to tasks.md, design.md, or any artifact
   - If user wants to continue discussion of uncovered contracts, suggest `/opsx:explore`

4. **Output `Harden Report`**:

```
## Harden Report — <change-name>

### Automated Results
| Contract Point | Test | Status | Rounds |
|---------------|------|--------|--------|
| CP-1: <desc> | test_foo.py::test_bar | ✓ PASSED | 1 |
| CP-2: <desc> | test_baz.py::test_qux | ✗ FAILED | 3 (max) |

### E2E Results
| Contract Point | Test | Status |
|---------------|------|--------|
| CP-3: <desc> | e2e/happy.spec.ts | ✓ PASSED |

### Manual Verification Required
| 初始状态 | 操作 | 预期状态变化 | Status |
|---------|------|-------------|--------|
| <state> | <action> | <expected> | PENDING |

### Manual Verification Summary
- Total: N items
- PASSED: 0
- FAILED: 0
- PENDING: N
- **Overall Manual Status: PENDING** (cannot be PASSED while items remain PENDING)

### Test Command Summary
| Category | Command | Result |
|----------|---------|--------|
| Unit | pytest tests/unit/ -v | 5/5 passed |
| E2E | playwright test e2e/ | 2/2 passed |

### Covered Contracts
| # | Contract Point | Method | Result |
|---|---------------|--------|--------|
| 1 | CP-1 | Automated | ✓ |
| 2 | CP-3 | E2E | ✓ |

### Uncovered Contracts
| # | Contract Point | Reason |
|---|---------------|--------|
| 4 | CP-4 | Non-critical UI expansion — suggest `/opsx:explore` for follow-up |

### Final Status: <PASSED / PARTIAL / FAILED>
```

5. **For manual items**: After outputting the report, if there are PENDING manual items, prompt the user:
   - "Please provide feedback on manual verification items (e.g., 'Item 1: PASSED, Item 2: FAILED — <reason>'). Reply 'skip' to leave items PENDING."
   - Process user feedback: update item statuses, re-output the Manual Verification section
   - If user skips, final status incorporates the PENDING items

## Guardrails

- Contract-point driven: organize by contracts, not by task checkboxes
- Do NOT write back to change artifacts (tasks.md, design.md, specs)
- Terminal report is the only result carrier
- No refactoring: only fix code to make tests pass, do not "clean up" or "improve" unrelated code
- Skip simple logic: if a module is pure CRUD/glue, explicitly mark "跳过" and do not test
- No complex mocks: keep test infrastructure minimal
- Manual checklists MUST use state transition matrix format (| 初始状态 | 操作 | 预期状态变化 |)
- E2E defaults to Playwright, Happy Path only
- Default max 3 retry rounds; user can override at Plan confirmation
- If execution reveals artifact deviation, STOP and wait — do not silently change scope
- Uncovered contracts should suggest `/opsx:explore` for follow-up, not pollute artifacts
