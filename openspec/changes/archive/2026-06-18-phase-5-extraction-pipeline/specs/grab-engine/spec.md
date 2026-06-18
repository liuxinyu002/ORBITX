# Grab Engine (Delta)

## REMOVED Requirements

### Requirement: Grab results are stored as request-scoped envelopes
**Reason**: Queue-based result storage is replaced by direct event emission to destination windows. Each shortcut now maps to exactly one consumer (Shortcut A → main window, Shortcut B → overlay), eliminating the need for multi-consumer request-scoped envelopes.
**Migration**: Remove `GrabState`, `GrabEnvelope`, and all queue operations from `src-tauri/src/grab/`. Replace `consume_grabbed_result` Tauri command invocations on the frontend with event listeners (`task:silent-extract` for main window, `view:render-overlay` for overlay).

## MODIFIED Requirements

### Requirement: Shortcut handler invokes degradation pipeline
The shortcut handler in `lib.rs` SHALL call `grab::grab_with_fallback(MAX_RAW_CHARS)` instead of directly calling `PlatformGrabEngine::new().grab_selected_text(MAX_RAW_CHARS)`.

**Shortcut A handler** SHALL, after grabbing: apply token truncation via `truncate_by_tokens`, then emit `task:silent-extract` with payload `{ text, truncated }` to the main window (`label: "main"`). No queue storage, no `grab-completed` event.

**Shortcut B handler** SHALL, after grabbing: apply token truncation via `truncate_by_tokens`, call the core `show_overlay` function with payload `{ text, truncated }` (no fallback). The core `show_overlay` function SHALL compute overlay position, emit `view:render-overlay` to the overlay window, and show/focus the window.

#### Scenario: Handler uses pipeline function
- **WHEN** any global shortcut triggers a grab
- **THEN** the handler SHALL call `grab_with_fallback` within the `spawn_blocking` closure, not the raw engine method

#### Scenario: Shortcut A emits task:silent-extract
- **WHEN** Shortcut A grab completes with text
- **THEN** the handler SHALL `emit_to("main", "task:silent-extract", { text, truncated })`

#### Scenario: Shortcut B calls show_overlay
- **WHEN** Shortcut B grab completes with text
- **THEN** the handler SHALL call the core `show_overlay` function with the text payload

## ADDED Requirements

### Requirement: Core show_overlay function
The system SHALL provide a private `show_overlay` function in `lib.rs` (or an appropriate module) that:

1. Checks if the overlay window exists (create if not, using the same `tauri.conf.json` label-based window config)
2. Computes overlay position via the existing `compute_overlay_position` function
3. Emits `view:render-overlay` to the overlay window with the given `OverlayPayload`
4. Shows and focuses the overlay window

This function SHALL be called internally by the Shortcut B handler and exposed to the frontend via the `show_overlay` Tauri command as a thin wrapper.

#### Scenario: Frontend invokes show_overlay
- **WHEN** the main window calls `invoke('show_overlay', { payload })`
- **THEN** the overlay window SHALL receive `view:render-overlay` and be shown

#### Scenario: show_overlay is idempotent
- **WHEN** `show_overlay` is invoked repeatedly
- **THEN** no duplicate overlay windows SHALL be created
