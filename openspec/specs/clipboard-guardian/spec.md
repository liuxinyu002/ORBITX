# Clipboard Guardian

## Purpose

Define the cross-platform clipboard safety channel that simulates a copy operation, reads the selected text from the clipboard, and restores the original clipboard content without trace — serving as a fallback when AX/UIA accessibility APIs cannot reach the selected text.

## Requirements

### Requirement: ClipboardGuardian save-backup-restore lifecycle
The system SHALL provide a `ClipboardGuardian` struct in `src-tauri/src/grab/clipboard.rs` that executes a complete clipboard capture cycle.

The capture cycle SHALL follow this sequence:
1. Acquire `CLIPBOARD_LOCK` via RAII guard
2. Perform a full backup of current clipboard contents (all types, all items)
3. Simulate Cmd+C (macOS) or Ctrl+C (Windows) via system-level key injection
4. Poll for clipboard change within a bounded timeout window
5. If clipboard changed: read the new text, truncated to `max_length` at the read point
6. Restore the original clipboard contents from backup
7. On macOS: inject `org.nspasteboard.TransientType` and `org.nspasteboard.ConcealedType` markers during restore
8. Release lock (via Drop)

#### Scenario: Full clipboard backup and restore
- **WHEN** `ClipboardGuardian::capture()` is invoked
- **THEN** all original clipboard items and their type representations SHALL be saved before the simulation and fully restored afterwards, regardless of success or failure of the text read

#### Scenario: Lock released on panic
- **WHEN** a panic occurs during the capture cycle
- **THEN** the `ClipboardLockGuard` Drop implementation SHALL release the lock, preventing permanent deadlock

### Requirement: macOS full clipboard backup via NSPasteboard
On macOS, the backup mechanism SHALL enumerate all items from `NSPasteboard.generalPasteboard.pasteboardItems` and preserve all available type representations as `(NSPasteboardType, NSData)` pairs.

The restore mechanism SHALL create a single `NSPasteboardItem` carrying all data, set `org.nspasteboard.TransientType` and `org.nspasteboard.ConcealedType` markers on it, then write all backed-up data to the item, and atomically write it to the pasteboard via `writeObjects`.

The `objc` crate SHALL be used for `NSPasteboard` ObjC interop. `CGEventCreateKeyboardEvent` and `CGEventPost` SHALL be called via raw `extern "C"` FFI bindings.

#### Scenario: Maccy/Paste ignores restored content
- **WHEN** clipboard restore is performed with `TransientType` and `ConcealedType` markers set after `clearContents`
- **THEN** compliant third-party clipboard managers SHALL ignore the subsequent write-back of original content

#### Scenario: Image in clipboard preserved
- **WHEN** the user's clipboard contains an image (e.g., `public.tiff` or `public.png` type) before the grab
- **THEN** after the capture cycle completes, the image SHALL be fully restored with its exact data

### Requirement: Windows full clipboard backup via IDataObject
On Windows, the backup mechanism SHALL obtain the current clipboard `IDataObject` via `OleGetClipboard`, enumerate all `FORMATETC` entries via `EnumFormatEtc`, and read each `STGMEDIUM` for full backup.

The restore mechanism SHALL call `OleSetClipboard` with the saved `IDataObject`, followed by `OleFlushClipboard` to flush the ole clipboard to the system clipboard.

Key injection SHALL use `SendInput` with a 4-event `INPUT` array (Ctrl down, 'C' down, 'C' up, Ctrl up) to ensure atomicity against physical keyboard input.

#### Scenario: IDataObject fully restored
- **WHEN** the user's clipboard contains multiple format types (e.g., `CF_UNICODETEXT`, `CF_HDROP`, `CF_BITMAP`)
- **THEN** after the capture cycle, all original format types and their data SHALL be exactly restored via `OleSetClipboard`

### Requirement: Clipboard change detection via polling
The system SHALL detect clipboard changes by polling:

- macOS: `NSPasteboard.changeCount` compared against the value before simulation
- Windows: `GetClipboardSequenceNumber` compared against the value before simulation

Polling SHALL occur at `CLIPBOARD_POLL_INTERVAL_MS` (default 5ms) intervals, with a total timeout of `CLIPBOARD_TIMEOUT_MS` (default 80ms).

#### Scenario: Clipboard changes within timeout
- **WHEN** the target application responds to the copy simulation within 50ms
- **THEN** the guardian SHALL detect the change count increment and proceed to read the new text

#### Scenario: Clipboard timeout
- **WHEN** the target application does not update the clipboard within 80ms
- **THEN** the guardian SHALL restore the original clipboard and return `GrabError::ClipboardTimeout`

### Requirement: Character threshold enforced at clipboard read boundary
The `read_pasteboard_text` (macOS) and `read_clipboard_text` (Windows) functions SHALL truncate the read text to `max_length` characters immediately at the read point, before returning to the caller.

#### Scenario: Long text truncated at read boundary
- **WHEN** the clipboard contains 50,000 characters after the copy simulation, and `max_length` is 10,000
- **THEN** only the first 10,000 characters SHALL be read and held in memory; the remaining 40,000 SHALL be discarded

### Requirement: Global CLIPBOARD_LOCK mutual exclusion
The system SHALL provide a global `AtomicBool` named `CLIPBOARD_LOCK` that prevents concurrent clipboard operations.

`ClipboardGuardian::capture()` SHALL `compare_exchange` the lock from `false` to `true` before proceeding. If the lock is already held, it SHALL immediately return `GrabError::ClipboardLockFailed`.

The lock SHALL be released via a `ClipboardLockGuard` RAII struct whose `Drop` implementation sets the flag to `false`.

#### Scenario: Concurrent shortcut attempts blocked
- **WHEN** Shortcut A triggers `capture()` and holds `CLIPBOARD_LOCK`
- **AND** Shortcut B triggers `capture()` before Shortcut A completes
- **THEN** Shortcut B SHALL receive `GrabError::ClipboardLockFailed` without touching the clipboard

### Requirement: Logging in Chinese
All clipboard guardian operations SHALL log in Chinese:
- Backup and restore operations at `debug` level
- Clipboard timeout at `warn` level
- Simulation and read failures at `error` level

#### Scenario: Timeout logged in Chinese
- **WHEN** clipboard polling times out
- **THEN** the log SHALL contain a `grab` target message in Chinese describing the timeout

### Requirement: Platform-conditional compilation
The `ClipboardGuardian` SHALL use `#[cfg(target_os = "macos")]` and `#[cfg(target_os = "windows")]` to compile platform-specific implementations from the same `clipboard.rs` source file.

Shared types (`ClipboardGuardian` struct, `ClipboardLockGuard` struct) SHALL be defined at module level without cfg gating. The `capture` method body SHALL dispatch to platform implementations via cfg-gated helper functions.

#### Scenario: macOS binary excludes Windows FFI
- **WHEN** the project is compiled for macOS
- **THEN** no Windows-specific FFI calls (`SendInput`, `OleGetClipboard`, etc.) SHALL be present in the binary
