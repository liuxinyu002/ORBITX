## MODIFIED Requirements

### Requirement: ClipboardGuardian save-backup-restore lifecycle
The system SHALL provide a `ClipboardGuardian` struct in `src-tauri/src/grab/clipboard.rs` that executes a complete clipboard capture cycle.

The capture cycle SHALL follow this sequence:
1. Acquire `CLIPBOARD_LOCK` via RAII guard
2. **macOS only**: Perform a full backup of current clipboard contents (all types, all items)
3. Simulate Cmd+C (macOS) or Ctrl+C (Windows) via system-level key injection
4. Poll for clipboard change within a bounded timeout window
5. If clipboard changed: read the new text, truncated to `max_length` at the read point
6. **macOS only**: Restore the original clipboard contents from backup
7. **macOS only**: Inject `org.nspasteboard.TransientType` and `org.nspasteboard.ConcealedType` markers during restore
8. Release lock (via Drop)

**Windows 与 macOS 行为差异**：Windows 上不执行备份与恢复。模拟 Ctrl+C 后剪贴板被选中文本覆盖，抓取到的文本留在剪贴板中供用户后续使用。此差异是刻意的——Windows OLE 剪贴板所有权转移机制不稳定，macOS 的 NSPasteboard 基于进程间通信无此问题。

#### Scenario: Full clipboard backup and restore (macOS)
- **WHEN** `ClipboardGuardian::capture()` is invoked on macOS
- **THEN** all original clipboard items and their type representations SHALL be saved before the simulation and fully restored afterwards, regardless of success or failure of the text read

#### Scenario: No backup-restore on Windows
- **WHEN** `ClipboardGuardian::capture()` is invoked on Windows
- **THEN** the clipboard SHALL NOT be backed up before Ctrl+C simulation, and SHALL NOT be restored after text read; the grabbed text SHALL remain on the clipboard

#### Scenario: Lock released on panic
- **WHEN** a panic occurs during the capture cycle
- **THEN** the `ClipboardLockGuard` Drop implementation SHALL release the lock, preventing permanent deadlock

### Requirement: Windows clipboard capture via legacy API
On Windows, the capture cycle SHALL be simplified to `simulate Ctrl+C → poll → read → return text`. No OLE API (`OleGetClipboard`, `OleSetClipboard`, `OleFlushClipboard`, `OleInitialize`, `OleUninitialize`) SHALL be called.

The `simulate_ctrl_c` function SHALL use `SendInput` with a release phase (release Shift and Ctrl to clear global hotkey modifier state, wait 15ms) followed by a clean Ctrl+C injection (Ctrl down, 'C' down, 'C' up, Ctrl up).

The `read_clipboard_text` function SHALL use the legacy clipboard API (`OpenClipboard`, `GetClipboardData(CF_UNICODETEXT)`, `GlobalLock`, `GlobalUnlock`, `CloseClipboard`) to read text, not `OleGetClipboard`.

No COM initialization (`CoInitializeEx` or `OleInitialize`) SHALL be required in the clipboard module. The UIA engine (`windows.rs`) manages its own COM lifecycle independently.

#### Scenario: Text grabbed and left on clipboard
- **WHEN** the capture cycle completes successfully on Windows with text "Hello World"
- **THEN** "Hello World" SHALL remain on the system clipboard after capture, available for `Ctrl+V`

#### Scenario: Clipboard overwrite accepted
- **WHEN** the user's clipboard contains a URL before capture
- **AND** the capture cycle simulates Ctrl+C on selected text "OrbitX"
- **THEN** the clipboard SHALL contain "OrbitX" (not the original URL) after capture

## REMOVED Requirements

### Requirement: Windows full clipboard backup via IDataObject
**Reason**: The OLE clipboard ownership transfer chain (`OleGetClipboard` → target app's `OleSetClipboard` → our `OleSetClipboard`) causes internal state corruption leading to hard access violation crashes in `OleSetClipboard` or `OleFlushClipboard`. Multiple remediation attempts (legacy API hybrid, OLE unification, delay settle) could not eliminate the crash.

**Migration**: Windows capture now runs without backup/restore. The grabbed text remains on the clipboard. No user action required.
