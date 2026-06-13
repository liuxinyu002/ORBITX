# Grab Engine

## Purpose

Define the cross-platform trait abstraction and error model for system-level text grabbing via accessibility APIs (macOS AXUIElement, Windows UIA).

## ADDED Requirements

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
The system SHALL expose a single `GrabError` enum with five variants shared across macOS and Windows:

| Variant | Semantic |
|---------|----------|
| `AccessibilityDenied` | 系统权限被拒绝，需引导用户授权 |
| `NoSelection` | 当前无选中文本（正常操作） |
| `UnsupportedElement` | 焦点控件不支持文本选择（正常操作） |
| `System(String)` | 未知底层 API 错误，保留原始信息 |
| `Internal(String)` | 非平台层错误（如 Mutex 污染） |

#### Scenario: Frontend receives unified error
- **WHEN** a grab fails on either macOS or Windows
- **THEN** the frontend receives one of the five `GrabError` variants with no platform-specific error codes

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
The Windows implementation SHALL use the official `windows` crate (`windows::Win32::UI::UIAutomation`). COM initialization (`CoInitializeEx`) SHALL run inside `spawn_blocking` to ensure thread safety.

The call chain SHALL be:
1. `CUIAutomation::new()` → UIA client
2. `GetFocusedElement(&elem)` → focused element
3. `elem.GetCurrentPattern(UIA_TextPatternId, &pattern)` → text pattern
4. `textPattern.GetSelection(&selection)` → selection array
5. If selection is empty → `NoSelection`
6. `selection[0].GetText(max_length as i32, &text)` → text (API-level truncation)

HRESULT errors SHALL be mapped via a private `fn map_uia_error(err: windows::core::Error) -> GrabError`.
COM initialization and cleanup SHALL be paired inside the same blocking thread via an RAII guard. UIA interfaces SHALL NOT be stored in Tauri State or moved across threads.

#### Scenario: Selected text successfully grabbed on Windows
- **WHEN** a user selects text in a supported Windows app and presses the shortcut
- **THEN** the engine returns the selected text up to `max_length` characters

#### Scenario: Control does not support TextPattern
- **WHEN** the focused control does not implement `UIA_TextPatternId`
- **THEN** the engine returns `GrabError::UnsupportedElement`

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
