## MODIFIED Requirements

### Requirement: Shortcut debounce and in-flight gating
The system SHALL process only `Pressed` events and SHALL ignore `Released` or auto-repeat notifications. Each shortcut SHALL maintain an independent in-flight flag and a minimum debounce interval.

#### Scenario: Repeated keypresses do not enqueue overlapping grabs
- **WHEN** the user rapidly presses the same shortcut multiple times
- **THEN** the system runs at most one grab task for that shortcut at a time

#### Scenario: In-flight flag released after grab failure
- **WHEN** a grab task completes with any error (including `System`, `Internal`, or clipboard access failures)
- **THEN** the in-flight flag SHALL be released, allowing subsequent shortcut triggers to proceed

#### Scenario: In-flight flag released after successful grab
- **WHEN** a grab task completes successfully
- **THEN** the in-flight flag SHALL be released, allowing subsequent shortcut triggers to proceed
