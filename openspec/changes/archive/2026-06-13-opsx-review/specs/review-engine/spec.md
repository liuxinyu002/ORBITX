# Review Engine

## Purpose

Define the review engine that reads change artifacts and produces a structured, severity-graded review checklist across 6 dimensions.

## ADDED Requirements

### Requirement: Auto-detect active change

When invoked without an explicit change name, the review engine SHALL scan `openspec/changes/` (excluding `archive/`) and automatically select the single active change. If multiple active changes exist, it SHALL prompt the user to specify which change to review.

#### Scenario: Single active change

- **WHEN** the user invokes `/opsx:review` without arguments and exactly one change exists in `openspec/changes/` (excluding `archive/`)
- **THEN** the engine SHALL automatically review that change

#### Scenario: Multiple active changes

- **WHEN** the user invokes `/opsx:review` without arguments and multiple changes exist
- **THEN** the engine SHALL list all active changes with lightweight context and ask the user to specify one

#### Scenario: Multiple active changes with context

- **WHEN** multiple active changes are listed for selection
- **THEN** each item SHALL include:
  - change name
  - last modified time
  - a one-line summary derived from proposal content

#### Scenario: Explicit change name

- **WHEN** the user invokes `/opsx:review phase-4-grab-engine-and-hotkeys`
- **THEN** the engine SHALL review the specified change regardless of other active changes

### Requirement: Default read-only artifact consumption

The review engine SHALL read proposal.md, design.md, specs/, and tasks.md from the target change directory. By default, it SHALL NOT modify any of these files unless the user explicitly authorizes applying the proposed fixes.

#### Scenario: No file modification

- **WHEN** the review engine identifies an issue in any artifact
- **AND** the user has not explicitly authorized changes
- **THEN** it SHALL describe the issue in the review output without modifying the source artifacts

#### Scenario: Authorized fix application

- **WHEN** the review engine has produced findings
- **AND** the user explicitly authorizes applying the proposed fixes
- **THEN** it SHALL first present a preview of the files to be modified and a brief summary of each planned change
- **AND** it SHALL update only the affected proposal/design/specs/tasks files with the minimum viable fix after the user confirms the scope

### Requirement: Six-dimension review

The review engine SHALL evaluate the change against all 6 review dimensions:

1. **执行审核 (Execution Review)**: task dependency chain integrity, file path validity, cross-change conflicts, capability permission coverage, non-goal scope creep
2. **UI审核 (UI Review)**: DESIGN.md compliance (particularly the 11 Don't rules), component state coverage (default/hover/focus/active/disabled/loading), dark mode coverage, accent color 5% rule, skeleton vs spinner usage, information density standards
3. **架构审核 (Architecture Review)**: N+1 query risks, large transaction detection, hardcoded configuration, module boundary violations, bloated controller/handler, data model extensibility, async isolation correctness, error mapping completeness
4. **韧性审核 (Resilience Review)**: timeout strategy for external dependencies, input threshold validation, permission failure degradation path, single point of failure identification, RAII resource cleanup correctness, retry backoff strategy
5. **可观测性审核 (Observability Review)**: key path log coverage (Chinese, correct level), user-visible error states, module `target` naming, performance metrics at critical nodes, frontend `console.log` violations
6. **依赖与供应链审核 (Dependency & Supply Chain Review)**: exact version pinning, known vulnerability exposure, platform conditional compilation correctness, necessity assessment for new dependencies, license compatibility

Each dimension SHALL produce zero or more findings.

#### Scenario: All dimensions executed

- **WHEN** the review engine runs
- **THEN** it SHALL evaluate all 6 dimensions regardless of findings in earlier dimensions

### Requirement: Three-tier severity grading

Every finding SHALL be assigned exactly one severity level:

- **🔴 Blocker**: Violates a hard engineering constraint or core architectural boundary and MUST be fixed in the proposal before implementation.
- **🟡 Should Fix**: Identifies a clear quality, performance, or maintainability risk that SHOULD be addressed before implementation.
- **🔵 Suggestion**: Identifies an optimization opportunity with no immediate risk.

#### Scenario: Blocker criteria

- **WHEN** a finding matches any of: breaking project network isolation, corrupting data safety boundaries, unresolvable task dependency chains, missing required capability permissions, unsafe resource handling, version-less or known-vulnerable dependencies
- **THEN** it SHALL be graded 🔴 Blocker

#### Scenario: Should Fix criteria

- **WHEN** a finding matches any of: N+1 query pattern, blocking UI modal, missing error state, missing dark mode coverage, missing key-path logging, hardcoded configuration without env fallback
- **THEN** it SHALL be graded 🟡 Should Fix

#### Scenario: Suggestion criteria

- **WHEN** a finding matches any of: suboptimal information density, wording inconsistency, minor layout optimization
- **THEN** it SHALL be graded 🔵 Suggestion

### Requirement: Collapsed output for passing dimensions

The review report SHALL only expand dimensions that contain findings. Dimensions with zero findings SHALL NOT be rendered as standalone sections, and their count SHALL be summarized in the global summary.

#### Scenario: Passing dimensions summarized

- **WHEN** the UI审核 dimension has zero findings
- **THEN** the report SHALL NOT output a dedicated `UI审核` section
- **AND** the passed dimension count in the summary SHALL include it

#### Scenario: Failing dimension expanded

- **WHEN** the 架构审核 dimension has at least one finding
- **THEN** the report SHALL expand the dimension with all findings listed as checklist items

### Requirement: Structured review output with global summary

The review output SHALL begin with a global summary line stating total Blocker/Warning counts, passed dimension count, and the review status (🔴 需修正 or 🟢 可继续). It SHALL also include explicit next-step actions. All findings SHALL be formatted as Markdown checklist items with severity prefix.

#### Scenario: Report with blockers

- **WHEN** the review produces one or more Blocker findings
- **THEN** the global summary SHALL read `诊断完成：发现 X 个 Blocker，Y 个 Warning，Z 个维度通过。当前状态：🔴 需修正`
- **AND** it SHALL include explicit next-step actions such as `仅修复 Blocker` or `仅保留诊断`

#### Scenario: Report without blockers

- **WHEN** the review produces no Blocker findings (regardless of Warning/Suggestion counts)
- **THEN** the global summary SHALL read `诊断完成：发现 0 个 Blocker，Y 个 Warning，Z 个维度通过。当前状态：🟢 可继续`
- **AND** it SHALL include explicit next-step actions such as `继续 apply` or `修复剩余 Warning`

### Requirement: Scoped authorization options

Before applying any fixes, the review engine SHALL allow the user to choose one of these scopes:

1. Fix Blockers only
2. Fix Blockers and Warnings
3. Confirm findings one by one
4. Keep diagnosis only

#### Scenario: Blockers-only authorization

- **WHEN** the user chooses to fix Blockers only
- **THEN** the engine SHALL apply fixes only for findings graded 🔴 Blocker

#### Scenario: Blockers-and-Warnings authorization

- **WHEN** the user chooses to fix Blockers and Warnings
- **THEN** the engine SHALL apply fixes only for findings graded 🔴 Blocker and 🟡 Should Fix

#### Scenario: Per-finding confirmation

- **WHEN** the user chooses one-by-one confirmation
- **THEN** the engine SHALL present each candidate fix individually and apply only the fixes explicitly confirmed by the user

#### Scenario: Diagnosis only

- **WHEN** the user chooses to keep diagnosis only
- **THEN** the engine SHALL exit without modifying any file

### Requirement: Fix suggestions for Blocker and Warning

For every 🔴 Blocker and 🟡 Should Fix finding, the review report SHALL include a concrete fix suggestion. The suggestion SHALL be restricted to one of:

1. Configuration fragment (JSON, TOML, YAML)
2. Architecture pseudocode (trait signatures, enum variants, data flow outline)
3. Schema change description (DDL, struct field additions)

The suggestion SHALL NOT contain complete function bodies, frontend JSX/TSX, or production-ready business logic.

#### Scenario: Blocker with fix suggestion

- **WHEN** a Blocker finding is reported
- **THEN** the report SHALL include a **修复建议** section with a code block containing the suggested fix at proposal/schema/config level

#### Scenario: Suggestion without fix code

- **WHEN** a Suggestion finding is reported
- **THEN** the report MAY include a brief textual recommendation without a mandatory code block

### Requirement: No review state file persisted

The review engine SHALL NOT create `openspec/changes/<name>/review.md` or any other dedicated review state file. Findings SHALL be presented in the current review interaction, and authorized fixes SHALL be written directly back to the original change artifacts.

#### Scenario: No review file created

- **WHEN** the review completes
- **AND** the user has not authorized changes
- **THEN** no new review artifact file SHALL be created

#### Scenario: Authorized fixes written to source artifacts

- **WHEN** the user explicitly authorizes the review engine to apply fixes
- **THEN** the engine SHALL modify only the relevant source artifacts under `openspec/changes/<name>/`
- **AND** it SHALL NOT create a separate review state file

### Requirement: Post-write change receipt

After applying authorized fixes, the review engine SHALL return a concise change receipt describing what was changed and what remains unresolved.

#### Scenario: Change receipt after write

- **WHEN** the engine completes authorized fix application
- **THEN** it SHALL list:
  - modified files
  - which findings were addressed in each file
  - which findings were intentionally left unchanged
