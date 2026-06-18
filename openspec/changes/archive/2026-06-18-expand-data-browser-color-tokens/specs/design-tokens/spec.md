## ADDED Requirements

### Requirement: Status feedback semantic tokens
The design token system SHALL include semantic tokens for status feedback states beyond the base brand colors. These tokens cover warning text, informational highlights, and multi-level destructive action states. Each token SHALL have both `:root` (light) and `.dark` (dark mode) CSS variable definitions.

#### Scenario: Warning text renders correctly in light mode
- **WHEN** a component displays warning text (e.g., "有未保存的修改")
- **THEN** the text color uses `--warning` token with HSL value `38 92% 50%`
- **THEN** the color is visually distinct from both `--foreground` and `--destructive-fg`

#### Scenario: Info highlight background renders correctly in light mode
- **WHEN** a new data row arrives in real-time and requires visual highlighting
- **THEN** the row background uses `--info` token with HSL value `214 100% 97%`
- **THEN** the highlight animates away via CSS transition to transparent

#### Scenario: Destructive foreground text renders independently
- **WHEN** a component displays inline error or destructive text without a destructive background (e.g., duplicate field name error, delete confirmation text)
- **THEN** the text color uses `--destructive-fg` token with HSL value `0 72% 51%`
- **THEN** `--destructive-fg` is distinct from `--destructive-foreground` (which is white text for use on destructive button backgrounds)

#### Scenario: Destructive subtle background for hover and confirmation states
- **WHEN** a user hovers over a delete button or a delete action enters confirmation mode
- **THEN** the background uses `--destructive-subtle` token with HSL value `0 86% 97%`
- **THEN** the background provides visual feedback without occupying excessive accent color coverage

#### Scenario: Dark mode warning token is dimmed
- **WHEN** the `dark` class is present on `<html>`
- **THEN** `--warning` renders at HSL `38 75% 52%` with reduced saturation to avoid glare on dark surfaces

#### Scenario: Dark mode info token uses dark background
- **WHEN** the `dark` class is present on `<html>`
- **THEN** `--info` renders at HSL `214 25% 16%` as a dark blue-tinted background, distinguishable from the card surface

#### Scenario: Dark mode destructive tokens adapt for dark surfaces
- **WHEN** the `dark` class is present on `<html>`
- **THEN** `--destructive-fg` renders at HSL `0 70% 58%` with adjusted lightness for dark backgrounds
- **THEN** `--destructive-subtle` renders at HSL `0 40% 12%` as a dark red-tinted background

### Requirement: Semantic token Tailwind configuration
All status feedback tokens SHALL be registered as top-level color aliases in `tailwind.config.ts`, enabling direct Tailwind utility class usage (e.g., `text-warning`, `bg-info`, `text-destructive-fg`, `bg-destructive-subtle`).

#### Scenario: Destructive tokens do not conflict with existing destructive namespace
- **WHEN** a component uses `text-destructive-fg`
- **THEN** the color resolves to `--destructive-fg` (red-600 equivalent)
- **THEN** `text-destructive-foreground` continues to resolve to `--destructive-foreground` (white)
- **THEN** the two token paths operate independently

#### Scenario: Info background with opacity modifier works correctly
- **WHEN** a component uses `bg-info/50` for a fading new-row animation
- **THEN** Tailwind generates `background-color: hsl(var(--info) / 0.5)`
- **THEN** the element background is semi-transparent, enabling CSS transition to fully transparent
