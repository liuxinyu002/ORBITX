---
name: openspec-test-reinforce
description: Test hardening for an OpenSpec change — Review → Plan → Execute → Report. Use when the user wants to reinforce an implemented change with tests, calls /opsx:harden, or asks to harden/test a change.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.1"
---

Test hardening for an OpenSpec change. Invoked as `/opsx:harden [change-name]` or via Skill tool as `openspec-test-reinforce`.

**Input**: Optionally specify a change name. If omitted, infer from conversation context, auto-select if only one active change exists, or prompt user to choose from `openspec list --json`.

Always announce: "Using change: <name>" and how to override.

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

6. **Output `Harden Plan`** and **wait for user confirmation**. Do NOT proceed until the user explicitly confirms. Confirmation authorizes automatic test writing, execution, and fixes within scope.

## Phase 4: Execute

**Prerequisite**: User has explicitly confirmed the Harden Plan.

### Steps

1. **Write/Supplement tests** for each Automated contract point following existing project conventions.
2. **Run tests** using the project's test commands.
3. **Diagnose failures** (if any):
   - **Implementation defect** → fix the implementation code (within scope)
   - **Test defect** → fix the test
   - **Environment issue** → **STOP** as BLOCKED
   - **Artifact deviation** → **STOP** as `WAITING_FOR_CONFIRMATION`
   - **Out of scope** → **STOP** as BLOCKED
4. **Retry loop**: Each round = `run → diagnose → fix → re-run`. Continue until all pass, max rounds reached, or stop condition triggers.

### Stop Conditions

| Condition | State |
|-----------|-------|
| Artifact deviation (fix would change behavior/scope) | `WAITING_FOR_CONFIRMATION` |
| Environment blocking | `BLOCKED` |
| Out of scope | `BLOCKED` |
| Max retry rounds exceeded (default 3) | `BLOCKED` |

## Phase 5: Harden Report

Output the final structured report with:
- **Automated Results**: per-contract-point pass/fail with round counts
- **E2E Results**: Happy Path coverage
- **Manual Verification Required**: state transition matrix items, each `PASSED`/`FAILED`/`PENDING`
- **Test Command Summary**: categories, commands, results
- **Covered Contracts**: contract points with passing verification
- **Uncovered Contracts**: not-verified contract points with reasons (do NOT write back to artifacts; suggest `/opsx:explore` for follow-up)
- **Final Status**: `PASSED` / `PARTIAL` / `FAILED`

Manual items: after the report, prompt user for feedback. Status cannot be `PASSED` while any manual item remains `PENDING`.

## Guardrails

- Contract-point driven: organize by contracts, not by task checkboxes
- Do NOT write back to change artifacts (tasks.md, design.md, specs)
- Terminal report is the only result carrier
- No refactoring during harden
- Skip simple logic: pure CRUD/glue → mark "跳过" and do not test
- No complex mocks
- Manual checklists MUST use state transition matrix format
- E2E defaults to Playwright, Happy Path only
- Default max 3 retry rounds
- If execution reveals artifact deviation, STOP and wait
- Uncovered contracts → suggest `/opsx:explore`
