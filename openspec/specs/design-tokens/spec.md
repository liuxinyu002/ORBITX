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
