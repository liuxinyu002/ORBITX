## MODIFIED Requirements

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

#### Scenario: Internal error not degraded
- **WHEN** AX/UIA returns `Internal`
- **THEN** the clipboard guardian SHALL NOT be invoked; the error SHALL be returned directly
