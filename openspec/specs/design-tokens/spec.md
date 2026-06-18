# Design Tokens

## Purpose

Define the OrbitX design token system, including brand color mappings, CSS variable overrides, Tailwind theme extensions, dark mode support, and component behavioral rules (Flat-By-Default, No-Pure Rule, 5% Rule).

## Requirements

### Requirement: Three-layer design token architecture
The design token system SHALL consist of three layers:

1. **Layer 1 (CSS Variables)** — `globals.css` overrides Shadcn UI default CSS custom properties with OrbitX brand colors
2. **Layer 2 (Tailwind Extensions)** — `tailwind.config.ts` extends the theme with `brand.slate`, `brand.dark`, `app.bg`, `app.surface` aliases mapped to CSS variables
3. **Layer 3 (DESIGN.md Rules)** — Component behavioral constraints (Flat-By-Default, 5% Rule, No-Pure Rule) enforced through code review, not programmatic linting

#### Scenario: CSS variables override Shadcn defaults
- **WHEN** a Shadcn UI component renders
- **THEN** it uses OrbitX brand colors instead of Shadcn defaults
- **THEN** `--primary` maps to HSL 215 16% 47% (Cool Slate #64748B)
- **THEN** `--background` maps to HSL 240 14% 97% (Warm Tinted Gray #F7F8FA)

#### Scenario: Tailwind aliases resolve correctly
- **WHEN** a component uses `bg-brand.slate` or `text-brand.dark` or `bg-app.bg`
- **THEN** the correct CSS color is applied as defined in the token mapping

### Requirement: Brand color token mapping
The following precise token mappings SHALL be defined:

| Token | Hex | Tailwind Alias | Usage |
|-------|-----|----------------|-------|
| Cool Slate | #64748B | `brand.slate` | Sole accent (buttons, focus rings, active states) ≤5% coverage |
| Near Black | #111827 | `brand.dark` | Primary text |
| Warm Tinted Gray | #F7F8FA | `app.bg` | Application background |
| Pure White | #FFFFFF | `app.surface` | Card/floating element surfaces |
| Muted Gray | #6B7280 | — (Shadcn default) | Secondary text, placeholders |
| Border Gray | #E5E7EB | — (Shadcn default) | Dividers, borders |

#### Scenario: Accent color coverage at rest ≤5%
- **WHEN** any screen is at rest (no dropdown open, no toast visible)
- **THEN** Cool Slate (#64748B) covers no more than 5% of the visible surface area

### Requirement: No-Pure Rule
The design SHALL NOT use `#000000` or `#FFFFFF` on any surface larger than a single character. All backgrounds SHALL be tinted toward warm gray, all text SHALL be tinted toward cool slate.

#### Scenario: App background is tinted, not pure white
- **WHEN** inspecting the root viewport background
- **THEN** the background color is #F7F8FA (Warm Tinted Gray), not #FFFFFF

#### Scenario: Primary text is tinted, not pure black
- **WHEN** inspecting body text
- **THEN** the text color is #111827 (Near Black), not #000000

### Requirement: Dark mode support (Phase-1)
The design system SHALL support dark mode via Tailwind `dark:` class strategy (`darkMode: "class"`). All CSS variables SHALL have `.dark {}` overrides. Components MUST use `dark:` variants for any color-sensitive element.

#### Scenario: Dark mode toggle
- **WHEN** the `dark` class is added to `<html>`
- **THEN** all surfaces switch to dark variants
- **THEN** text remains readable (minimum 4.5:1 contrast ratio for body text)

### Requirement: Flat-By-Default component rule
No persistent on-screen element SHALL cast a CSS box-shadow at rest. Shadows SHALL appear only as state feedback (dropdown opening, toast arriving) and disappear with the element. Depth separation SHALL be conveyed through background color shifts (tinted gray → white) and 1px borders.

#### Scenario: Cards at rest have no shadow
- **WHEN** a card component is rendered in default state
- **THEN** the `box-shadow` property is `none`

#### Scenario: Dropdown menu receives elevation
- **WHEN** a dropdown menu is open
- **THEN** it renders with `box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)` (Float shadow)

### Requirement: Typography stack
The project SHALL use system-native font stacks only — no web font imports, no display faces. Sans-serif stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. Mono stack: `"SF Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace`.

#### Scenario: No web fonts loaded
- **WHEN** the app renders
- **THEN** zero network requests for font files are made
- **THEN** all text renders in system-native typefaces

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
