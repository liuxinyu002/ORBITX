# Grab Engine (Delta — Phase 4.5 Clipboard Fallback)

## Purpose

Amend the grab engine's error model and invocation pipeline to support multi-strategy degradation when the primary AX/UIA accessibility path fails.

## ADDED Requirements

### Requirement: ClipboardTimeout and ClipboardLockFailed error variants
The `GrabError` enum SHALL include two additional variants:

| Variant | Semantic |
|---------|----------|
| `ClipboardTimeout` | 目标应用未在时间窗口内响应模拟复制 |
| `ClipboardLockFailed` | 剪贴板并发锁冲突，另一个快捷键正在使用剪贴板通道 |

These variants SHALL be serializable/deserializable via Serde and available to the frontend through the existing `consume_grabbed_result` command.

#### Scenario: ClipboardTimeout propagated to frontend
- **WHEN** the clipboard guardian times out waiting for the target application
- **THEN** the frontend receives `GrabError::ClipboardTimeout` and displays a toast message "目标应用未响应，请重试"

#### Scenario: ClipboardLockFailed propagated to frontend
- **WHEN** two shortcuts attempt clipboard operations concurrently
- **THEN** the second request receives `GrabError::ClipboardLockFailed` and the frontend displays "操作太频繁，请稍后再试"

### Requirement: Degradation pipeline function
The system SHALL provide a `grab::grab_with_fallback(max_length: usize) -> Result<String, GrabError>` function in `src-tauri/src/grab/mod.rs`.

The pipeline SHALL execute:
1. Try `PlatformGrabEngine::new().grab_selected_text(max_length)` — AX/UIA fast path
2. If the result is `Err(NoSelection)` or `Err(UnsupportedElement)`: fall through to Layer 2
3. If the result is `Err(AccessibilityDenied)`, `Err(System)`, or `Err(Internal)`: return the error immediately
4. Layer 2: `ClipboardGuardian::new(CLIPBOARD_TIMEOUT_MS, CLIPBOARD_POLL_INTERVAL_MS).capture(max_length)`
5. Return the clipboard result or error

#### Scenario: AX/UIA succeeds, clipboard not touched
- **WHEN** the AX/UIA path returns selected text successfully
- **THEN** the clipboard SHALL NOT be read, written, or modified in any way

#### Scenario: AX/UIA returns NoSelection, clipboard succeeds
- **WHEN** AX/UIA returns `NoSelection`
- **THEN** the clipboard guardian SHALL be invoked as fallback; if it returns text, the pipeline SHALL return that text

#### Scenario: AccessibilityDenied not degraded
- **WHEN** AX/UIA returns `AccessibilityDenied`
- **THEN** the clipboard guardian SHALL NOT be invoked; the error SHALL be returned directly

### Requirement: Shortcut handler invokes degradation pipeline
The shortcut handler in `lib.rs` SHALL call `grab::grab_with_fallback(MAX_RAW_CHARS)` instead of directly calling `PlatformGrabEngine::new().grab_selected_text(MAX_RAW_CHARS)`.

Token truncation, envelope creation, event emission, and in-flight flag release SHALL remain unchanged from Phase 4.

#### Scenario: Handler uses pipeline function
- **WHEN** any global shortcut triggers a grab
- **THEN** the handler SHALL call `grab_with_fallback` within the `spawn_blocking` closure, not the raw engine method

#### Scenario: ClipboardTimeout in overlay
- **WHEN** overlay receives a `ClipboardTimeout` error via `consume_grabbed_result`
- **THEN** overlay SHALL switch to `{ tag: "empty" }` state and display a toast "目标应用未响应，请重试"

#### Scenario: ClipboardLockFailed in overlay
- **WHEN** overlay receives a `ClipboardLockFailed` error via `consume_grabbed_result`
- **THEN** overlay SHALL switch to `{ tag: "empty" }` state and display a toast "操作太频繁，请稍后再试"

## MODIFIED Requirements

### Requirement: GrabError enum
The system SHALL expose a single `GrabError` enum with seven variants shared across macOS and Windows:

| Variant | Semantic |
|---------|----------|
| `AccessibilityDenied` | 系统权限被拒绝，需引导用户授权 |
| `NoSelection` | 当前无选中文本（正常操作） |
| `UnsupportedElement` | 焦点控件不支持文本选择（正常操作） |
| `ClipboardTimeout` | 目标应用未在时间窗口内响应模拟复制 |
| `ClipboardLockFailed` | 剪贴板并发锁冲突 |
| `System(String)` | 未知底层 API 错误，保留原始信息 |
| `Internal(String)` | 非平台层错误（如 Mutex 污染） |

#### Scenario: Frontend receives unified error
- **WHEN** a grab fails on either macOS or Windows via any layer (AX/UIA or clipboard)
- **THEN** the frontend receives one of the seven `GrabError` variants with no platform-specific error codes
