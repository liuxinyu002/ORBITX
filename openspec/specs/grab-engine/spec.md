# Grab Engine

## Purpose

Define the cross-platform trait abstraction and error model for system-level text grabbing via accessibility APIs (macOS AXUIElement, Windows UIA).

## Requirements

### Requirement: GrabEngine trait definition
The system SHALL define a `GrabEngine` trait in `src-tauri/src/grab/mod.rs` with a single method:

```rust
fn grab_selected_text(&self, max_length: usize) -> Result<String, GrabError>;
```

The trait SHALL be platform-agnostic. Platform-specific implementations (`MacGrabEngine`, `WinGrabEngine`) SHALL be injected via `#[cfg(target_os)]` conditional compilation. Each shortcut invocation SHALL create a new instance (no Tauri State persistence).

#### Scenario: Trait method accepts max_length
- **WHEN** a caller invokes `grab_selected_text(2000)`
- **THEN** the engine SHALL NOT return text longer than 2000 characters, with truncation occurring at the OS API level where possible

#### Scenario: New instance per invocation
- **WHEN** a shortcut triggers a grab
- **THEN** the engine SHALL be created fresh via `PlatformGrabEngine::new()` and dropped after use

### Requirement: GrabError enum
The system SHALL expose a single `GrabError` enum with seven variants shared across macOS and Windows:

| Variant | Semantic |
|---------|----------|
| `AccessibilityDenied` | 系统权限被拒绝，需引导用户授权 |
| `NoSelection` | 当前无选中文本（正常操作） |
| `UnsupportedElement` | 焦点控件不支持文本选择（正常操作） |
| `ClipboardTimeout` | 目标应用未在时间窗口内响应模拟复制 |
| `ClipboardLockFailed` | 剪贴板并发锁冲突，另一个快捷键正在使用剪贴板通道 |
| `System(String)` | 未知底层 API 错误，保留原始信息 |
| `Internal(String)` | 非平台层错误（如 Mutex 污染） |

These variants SHALL be serializable/deserializable via Serde and available to the frontend through the existing `consume_grabbed_result` command.

#### Scenario: Frontend receives unified error
- **WHEN** a grab fails on either macOS or Windows via any layer (AX/UIA or clipboard)
- **THEN** the frontend receives one of the seven `GrabError` variants with no platform-specific error codes

#### Scenario: ClipboardTimeout propagated to frontend
- **WHEN** the clipboard guardian times out waiting for the target application
- **THEN** the frontend receives `GrabError::ClipboardTimeout` and displays a toast message "目标应用未响应，请重试"

#### Scenario: ClipboardLockFailed propagated to frontend
- **WHEN** two shortcuts attempt clipboard operations concurrently
- **THEN** the second request receives `GrabError::ClipboardLockFailed` and the frontend displays "操作太频繁，请稍后再试"

### Requirement: macOS grab via AXUIElement
The macOS implementation SHALL use `core-foundation` with minimal `extern "C"` bindings for 5 functions (`AXUIElementCreateSystemWide`, `AXUIElementCopyAttributeValue`, `AXUIElementCopyParameterizedAttributeValue`, `AXValueCreate`, `AXValueGetValue`) and the minimum required AX constants (`kAXFocusedApplicationAttribute`, `kAXFocusedUIElementAttribute`, `kAXSelectedTextRangeAttribute`, `kAXStringForRangeParameterizedAttribute`). No `objc2` dependency SHALL be introduced.

The call chain SHALL be:
1. `AXUIElementCreateSystemWide()` → system-wide AX reference
2. Copy `kAXFocusedApplicationAttribute` → focused app
3. Copy `kAXFocusedUIElementAttribute` → focused element
4. Copy `kAXSelectedTextRangeAttribute` → selected range
5. Validate the returned type as `AXValue(CFRange)` and extract the original `CFRange`
6. If range length exceeds `max_length`, clamp to `CFRange::new(original.location, max_length as CFIndex)`
7. Wrap the clamped range with `AXValueCreate(kAXValueCFRangeType, ...)`
8. Copy `kAXStringForRangeParameterizedAttribute` with the `AXValue(CFRange)` parameter → text
9. Perform a final Rust-side truncation on Unicode scalar boundaries before returning

AXError codes SHALL be mapped to `GrabError` within a private `fn map_ax_error(code: i32) -> GrabError` function.

All CoreFoundation objects returned from `Copy*` APIs SHALL be owned by Rust RAII wrappers and released exactly once. Type validation SHALL occur before any cast from `CFTypeRef` to `AXUIElementRef`, `AXValueRef`, or `CFStringRef`.

#### Scenario: Selected text successfully grabbed
- **WHEN** a user selects text in a supported macOS app and presses the shortcut
- **THEN** the engine returns the selected text up to `max_length` characters

#### Scenario: No text selected
- **WHEN** no text is selected in the focused element
- **THEN** the engine returns `GrabError::NoSelection`

#### Scenario: Accessibility permission denied
- **WHEN** OrbitX lacks Accessibility permission in System Settings
- **THEN** the engine returns `GrabError::AccessibilityDenied`

### Requirement: Windows grab via UI Automation
The Windows implementation SHALL use the official `windows` crate (`windows::Win32::UI::Accessibility`). COM initialization (`CoInitializeEx`) SHALL run inside `spawn_blocking` to ensure thread safety.

The call chain SHALL be a multi-level strategy:

**Level 1 — Direct extraction:**
1. `CUIAutomation::new()` → UIA client
2. `GetFocusedElement()` → focused element
3. `GetCurrentPattern(UIA_TextPatternId)` → text pattern
4. `GetSelection()` → selection array; if empty → `NoSelection`
5. `selection[0].GetText(max_length)` → text; if non-empty and non-whitespace → return

**Level 2 — TreeWalker fallback:**
6. If the Level 1 result passes `should_activate_treewalker` (i.e. is `UnsupportedElement` or empty/whitespace-only text) → acquire `ControlViewWalker` from UIA client. Results that do NOT trigger TreeWalker include `NoSelection`, `System`, `AccessibilityDenied`, `ClipboardTimeout`, `ClipboardLockFailed`, `Internal`, and any non-empty text — these are returned directly from Level 1.
7. Depth-first traverse child elements from the focused element using `GetFirstChildElement` / `GetNextSiblingElement`; the focused element itself is visited as node 1 before descending into children
8. For each visited node: check `GetCurrentPattern(UIA_TextPatternId)`, then `GetSelection()`, then `GetText(max_length)`
9. Return text from the first matching node; stop traversal immediately
10. Enforce `MAX_TREEWALKER_NODES` (500) hard limit; if exhausted → `UnsupportedElement`

HRESULT errors SHALL be mapped via a private `fn map_uia_error(err: windows::core::Error) -> GrabError`.
COM initialization and cleanup SHALL be paired inside the same blocking thread via an RAII guard. UIA interfaces SHALL NOT be stored in Tauri State or moved across threads.

#### Scenario: Selected text successfully grabbed on Windows via Level 1
- **WHEN** a user selects text in a supported Windows app (e.g., Notepad) and presses the shortcut
- **THEN** Level 1 (direct GetFocusedElement) SHALL succeed; TreeWalker SHALL NOT be invoked

#### Scenario: Selected text grabbed via TreeWalker from child node
- **WHEN** a user selects text in an Electron/Chromium app (e.g., WeChat) where the focused element lacks TextPattern, and presses the shortcut
- **THEN** Level 1 SHALL return `UnsupportedElement`; Level 2 TreeWalker SHALL traverse child nodes and return the selected text from the first text-bearing node

#### Scenario: Control does not support TextPattern at any level
- **WHEN** the focused control and all traversed descendants (up to 500 nodes) do not support `UIA_TextPatternId`
- **THEN** the engine SHALL return `GrabError::UnsupportedElement`

### Requirement: Logging for grab operations
Grab results SHALL be logged in Chinese via the project's `log` function:
- `NoSelection` and `UnsupportedElement` at `debug` level
- `AccessibilityDenied` at `warn` level with guidance message
- `System` and `Internal` at `error` level with original error details

#### Scenario: Normal grab recorded at debug level
- **WHEN** `NoSelection` is returned
- **THEN** the Rust backend logs at `debug` level without polluting regular log output

### Requirement: Grab results are stored as request-scoped envelopes
The system SHALL store grab results as request-scoped envelopes rather than a single global string slot.

```rust
struct GrabEnvelope {
    request_id: String,
    source: GrabSource,
    result: Result<String, GrabError>,
    created_at_ms: u64,
}
```

The backend SHALL expose `consume_grabbed_result(request_id)` and remove only the matching envelope. Results SHALL expire after a bounded TTL and the queue length SHALL be capped.

#### Scenario: Overlay and main window do not steal each other's result
- **WHEN** two grab requests are completed close together
- **THEN** each frontend consumer retrieves only the envelope matching its own `request_id`

### Requirement: Degradation pipeline function
The system SHALL provide a `grab::grab_with_fallback(max_length: usize) -> Result<String, GrabError>` function in `src-tauri/src/grab/mod.rs`.

The pipeline SHALL execute:
1. Try `PlatformGrabEngine::new().grab_selected_text(max_length)` — AX/UIA fast path
2. If the result is `Err(NoSelection)`, `Err(UnsupportedElement)`, `Err(System)`, or `Ok(s)` where `s.trim().is_empty()`: fall through to Layer 2
3. If the result is `Err(AccessibilityDenied)` or `Err(Internal)`: return the error immediately
4. Layer 2: `ClipboardGuardian::new(CLIPBOARD_TIMEOUT_MS, CLIPBOARD_POLL_INTERVAL_MS).capture(max_length)`
5. Return the clipboard result or error

#### Scenario: AX/UIA succeeds, clipboard not touched
- **WHEN** the AX/UIA path returns selected text successfully
- **THEN** the clipboard SHALL NOT be read, written, or modified in any way

#### Scenario: AX/UIA returns NoSelection, clipboard succeeds
- **WHEN** AX/UIA returns `NoSelection`
- **THEN** the clipboard guardian SHALL be invoked as fallback; if it returns text, the pipeline SHALL return that text

#### Scenario: AX/UIA returns System error, degrades to clipboard
- **WHEN** AX/UIA returns `Err(GrabError::System(_))` (e.g., UIA HRESULT=0x00000000)
- **THEN** the pipeline SHALL degrade to the clipboard channel rather than returning the error immediately

#### Scenario: AX/UIA returns empty or whitespace-only text, degrades to clipboard
- **WHEN** AX/UIA returns `Ok("")` or `Ok("   ")` (e.g., Chromium UIA provider defect where TextPattern is exposed but GetText() returns no content)
- **THEN** the pipeline SHALL degrade to the clipboard channel rather than returning the empty result

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
