---
name: OrbitX
description: A privacy-first, air-gapped desktop AI toolbox that disappears into the task.
colors:
  primary: "#64748B"
  primary-foreground: "#FFFFFF"
  neutral-bg: "#F3F4F7"
  neutral-surface: "#FFFFFF"
  neutral-text: "#030712"
  neutral-text-muted: "#687080"
  neutral-border: "#E4E7EB"
  neutral-bg-dark: "#0E121C"
  neutral-surface-dark: "#161C29"
  neutral-text-dark: "#E2E4E7"
  neutral-text-muted-dark: "#7D838C"
  neutral-border-dark: "#21283A"
  destructive: "#EF4444"
  destructive-foreground: "#FFFFFF"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-compact:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.375
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.025em"
  mono:
    fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "color-mix(in oklch, {colors.primary}, #000 20%)"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "hsl(220 14% 95%)"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
---

# Design System: OrbitX

## 1. Overview

**Creative North Star: "The Precision Instrument"**

OrbitX is a machinist's caliper, not a Swiss army knife. Every surface, every spacing decision, every pixel serves the user's current task. There is no decoration — only information, action, and feedback. The interface should feel like it was machined from a single block of metal: cool to the touch, perfectly weighted, with tolerances tight enough that nothing rattles.

This is a system of deliberate absence. The accent color barely registers as color. The shadows are so subtle they're felt rather than seen. The typography is the OS default, because the user should never notice the font — only the data it presents. When the tool is not actively summoned, it does not exist. When it is, it speaks in short, unambiguous sentences and then gets out of the way.

This system explicitly rejects the visual language of "AI" products: no glowing gradients, no shimmer animations, no glassmorphism, no entertainment. OrbitX is a productivity instrument built for knowledge workers who value their flow state above all else.

**Key Characteristics:**
- Monochromatic with purpose — a single Cool Slate accent at ≤5% surface coverage
- System-native typography — no web fonts, no display faces; `-apple-system` on macOS, `Segoe UI` on Windows
- Flat by default — shadows appear only as state feedback (floating panels, toasts), never as decoration
- Compact density — data grid at 13px, tight row heights, no generous whitespace
- Keyboard-first — every visible focus state is unambiguous, every action reachable without a mouse
- CSS custom properties via HSL channels — theme tokens defined as `215 16% 47%` format for Tailwind compatibility

## 2. Colors

A near-monochromatic palette anchored in cool grays, defined as HSL channel values for Tailwind CSS integration. The accent is so restrained it reads as an extension of the neutral scale — a slate that happens to lean blue by a few degrees. There is no secondary accent, no tertiary. One voice.

Light mode values listed below; dark mode equivalents are defined under the `.dark` CSS class selector in `src/styles/globals.css`.

### Primary
- **Cool Slate** (hsl(215 16% 47%), #64748B): The sole accent. Used exclusively on primary action buttons (background), focus rings (`--ring`), current selection indicators, and active navigation states. Never used as decoration, never as a background tint, never at opacity below 100% on interactive elements. Its rarity is its power. Mapped to Shadcn's `--primary` CSS variable.

### Neutral
- **Warm Tinted Background** (hsl(240 14% 97%), #F3F4F7): Application background. A near-white with the faintest cool undertone, preventing the sterile feel of pure #FFF on large surfaces. Mapped to `--background` and `--app-bg`. Applied to the root viewport, sidebar panels, and empty states.
- **Pure White Surface** (hsl(0 0% 100%), #FFFFFF): Card and floating element surfaces. Mapped to `--card`, `--popover`, `--app-surface`. Reserved for elevated containers (command palette stubs, dropdown menus, toast notifications, setting panels) to create a clean figure/ground relationship against the tinted background.
- **Near Black Text** (hsl(224 71% 4%), #030712): Primary text. Mapped to `--foreground`, `--brand-dark`. High contrast for body copy, data grid cells, labels, and input values. Never pure #000 — the deep blue undertone softens reading at density.
- **Muted Gray** (hsl(215 13% 47%), #687080): Secondary text, placeholders, captions, and metadata. Mapped to `--muted-foreground`. Used where information is supplemental rather than actionable.
- **Border Gray** (hsl(213 13% 91%), #E4E7EB): Dividers, table borders, input strokes. Mapped to `--border`, `--input`. Present enough to define space, light enough to not compete with content.
- **Destructive Red** (hsl(0 84% 60%), #EF4444): Error states, destructive action warnings, invalid input indicators. Mapped to `--destructive`. Used sparingly.

### Dark Mode
- Background: hsl(224 35% 8%), #0E121C — deep slate, not pure black
- Surface: hsl(224 35% 12%), #161C29 — slightly lifted from background
- Text: hsl(220 14% 90%), #E2E4E7 — soft white, never pure #FFF
- Text Muted: hsl(215 10% 55%), #7D838C
- Border: hsl(224 28% 18%), #21283A

### Named Rules
**The 5% Rule.** The Cool Slate accent covers no more than 5% of any given screen at rest. If you can spot the accent without scanning for it, it is used too heavily. Its restraint is what makes primary actions legible — when everything is accented, nothing is.

**The No-Pure Rule.** Never use #000 or #FFF on any surface larger than a single character. Backgrounds are tinted toward cool gray; text is tinted toward deep blue-slate. Pure black and pure white read as unfinished, not minimal.

**The HSL Channel Rule.** All design tokens in CSS are stored as bare HSL channel values (e.g. `215 16% 47%`). Tailwind utilities resolve them via `hsl(var(--token))`. This allows the Shadcn palette system and dark mode overrides to work with zero duplication — swap the channels under `.dark`, and every component inherits the change.

## 3. Typography

**Font Stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` (CSS variable `--font-sans`)
**Mono Stack:** `"SF Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace` (CSS variable `--font-mono`)

**Character:** The user should never notice the typeface. System fonts guarantee zero latency, zero FOUT, and perfect OS integration. The hierarchy is built through weight and size alone — no color, no tracking gimmicks, no display faces.

### Hierarchy
- **Title** (500, 16px, 1.375): Page headings, card titles. Appears on the Dashboard ("ORBITX" brand name) and the Tool interior header. Rendered via Shadcn's `CardTitle` component (`text-base font-medium`).
- **Body** (400, 14px, 1.5, max 70ch): Prose content, form labels, descriptions, settings copy. Capped at 70 characters per line for readability. Rendered via Tailwind's `text-sm`.
- **Body Compact** (400, 13px, 1.4): Data grid cells, table headers, task list items. The workhorse size for information-dense surfaces. Line length is unconstrained in table contexts — 120ch+ is acceptable.
- **Label** (500, 12px, 1.3, letter-spacing: 0.025em): Section overlines, column category headers, status badges. Used sparingly via Shadcn's `DropdownMenuLabel` component (`text-xs`).
- **Mono** (400, 13px, 1.5): Code blocks, technical values, schema field names.

### Named Rules
**The One Family Rule.** OrbitX uses a single sans-serif family across all surfaces. No display/body pairing, no brand typeface, no web font loading. The hierarchy is in the scale, not the family.

## 4. Elevation

OrbitX is flat by design. Depth is conveyed through background tint layering (tinted gray → white → white with border), not through shadow. Only the dropdown menu and toast notification receive elevation treatment, and even then, shadows are tight and minimal — a 1px ring (`ring-1 ring-foreground/10`) does more work than the box-shadow.

### Shadow Vocabulary
- **Dropdown Float** (`shadow-md` + `ring-1 ring-foreground/10`): Reserved for the dropdown menu content panel. A Radix UI-animated slide-in from the trigger edge with a tight shadow. Duration: 100ms on close (`data-closed`), instant on open.
- **Toast** (Sonner library defaults, theme-bound): Light toast background (`--popover`), border (`--border`), and radius (`--radius`) tokens. Success/Info/Warning/Error icons via Lucide, loading via animated spinner.

Everything else — cards, panels, the data grid, settings surfaces — sits flat against its background with no elevation. Separation comes from background color shifts and 1px borders, never from z-axis illusion.

### Named Rules
**The Flat-By-Default Rule.** No element casts a shadow at rest. Shadows appear only as a response to state (a dropdown opening, a toast arriving) and disappear with the element. If an object is always on screen, it is always flat.

## 5. Components

All interactive components follow the product register requirement: default, hover, focus, active, disabled, and loading states are defined. Components are sourced from Shadcn UI (Radix primitives + Tailwind styling) with the base color set to `slate` and CSS variables enabled.

### Buttons
- **Shape:** Rounded-lg (`--radius` = 0.5rem, Tailwind `rounded-lg` = 8px). The `xs` and `sm` icon sizes use a dynamic `rounded-[min(var(--radius-md),10px)]` for proportion at small scales.
- **Primary (`variant="default"`):** Cool Slate background (`bg-primary`), white text. Hover: `bg-primary/80` (slight transparency darkening). Focus-visible: `border-ring` + `ring-3 ring-ring/50` (3px ring at 50% opacity). Active: `translate-y-px` (1px downward press). Disabled: `opacity-50`, no pointer events.
- **Ghost (`variant="ghost"`):** Transparent background. Hover: `bg-muted`. Used for the Header back button and toolbar actions.
- **Outline (`variant="outline"`):** Transparent background with border (`border-border`). Hover: `bg-muted`.
- **Secondary (`variant="secondary"`):** Light gray background (`bg-secondary`). Hover: `color-mix(in oklch, var(--secondary), var(--foreground) 5%)`.
- **Destructive (`variant="destructive"`):** Red tint background (`bg-destructive/10`), red text. Hover: `bg-destructive/20`. Used only for irreversible actions.
- **Sizes:** `icon` (32×32px), `icon-xs` (24×24px), `icon-sm` (28×28px), `icon-lg` (36×36px), `default` (32px), `sm` (28px), `xs` (24px), `lg` (36px).

### Inputs
- **Style:** Rounded-lg (8px), transparent background, 1px border (`border-input`), 32px height (`h-8`). Horizontal padding: 10px.
- **Placeholder:** `text-muted-foreground` (Muted Gray).
- **Focus:** `border-ring` + `ring-3 ring-ring/50` — matching the Button focus vocabulary exactly.
- **Disabled:** `bg-input/50`, `opacity-50`, no pointer events.
- **Invalid:** `border-destructive` + `ring-3 ring-destructive/20`.

### Cards
- **Style:** Rounded-lg (8px), white background (`bg-card`), 1px ring (`ring-1 ring-foreground/10`). Internal spacing via `--card-spacing` CSS variable (default: `--spacing(4)` = 16px).
- **Sub-components:** `CardHeader` (title + optional description + optional action slot), `CardContent` (body), `CardFooter` (bordered top, muted background, action buttons).
- **Density variant:** `size="sm"` reduces `--card-spacing` to `--spacing(3)` = 12px and title font-size to `text-sm`.

### Dropdown Menu
- **Style:** Rounded-lg (8px), white surface (`bg-popover`), 1px ring (`ring-1 ring-foreground/10`), `shadow-md`. Min width: 128px, max height constrained by available viewport space.
- **Items:** Rounded-md (6px), 1.5px gap, `text-sm`. Hover/Focus: `bg-accent text-accent-foreground`. Destructive variant: red text, red tint background on focus.
- **Labels:** `text-xs font-medium text-muted-foreground`, used for grouping.
- **Separators:** `h-px bg-border`, negative horizontal margins to span full width.
- **Animation:** Radix `data-open:animate-in fade-in-0 zoom-in-95` / `data-closed:animate-out fade-out-0 zoom-out-95` with `duration-100`. Slides in from the trigger edge direction.
- **Sub-menus:** Nested content slides in from parent with identical animation vocabulary.

### Toast (Sonner)
- **Style:** Theme-bound via MutationObserver on `<html>` class changes. Light/dark switching is automatic and immediate. Border-radius via `--radius` token.
- **Icons:** Lucide icons — `CircleCheck` (success), `Info` (info), `TriangleAlert` (warning), `OctagonX` (error), `Loader2` with `animate-spin` (loading). All at `size-4` (16px).
- **Positioning:** Sonner default (bottom-right). No custom position override in MVP.

### Header
- **Style:** Fixed 40px height (`h-10`), bottom border (`border-b border-border`), horizontal padding `px-4`. Background inherits from root surface.
- **Root route:** Displays brand name "ORBITX" in `text-sm font-medium text-brand-dark`. No back button.
- **Sub-routes:** Displays back button (Lucide `ArrowLeft`, 32×32px touch target, rounded, `text-muted-foreground`) + page title. Hover on back button: `bg-muted text-foreground`.
- **Platform awareness:** CSS `data-platform` attribute on `<html>` drives padding — macOS: `padding-left: 80px` (traffic light clearance), Windows: `padding-right: 120px` (min/max/close clearance).

### Dashboard Grid
- **Style:** CSS Grid with `grid-cols-[repeat(auto-fill,minmax(280px,1fr))]`, 16px gap, 24px container padding. Cards inside are full-width links with `hover:bg-muted` transition.

### Error Boundary
- **Style:** Centered layout (flex column, centered both axes), 18px title (`text-lg font-medium`), 14px description (`text-sm text-muted-foreground`). Header preserved above the error state. Copy: "应用遇到问题" / "请通过系统托盘退出并重启应用" (Chinese, matching the app's primary locale).

## 6. Do's and Don'ts

### Do:
- **Do** use the system font stack (`--font-sans`) everywhere. No web font imports.
- **Do** define CSS tokens as bare HSL channel values (e.g. `215 16% 47%`) and consume them via `hsl(var(--token))` in Tailwind.
- **Do** use the Cool Slate accent (#64748B, `hsl(var(--primary))`) at full opacity on interactive elements; never as a decorative tint or background wash.
- **Do** keep the data grid at 13px with tight row heights — this is a productivity tool, not a reading experience.
- **Do** use rounded-lg (8px) on all interactive elements — buttons, inputs, cards, dropdowns. The entire UI shares one radius scale.
- **Do** convey depth through background tint shifts (Background Gray → White Surface) rather than shadows for persistent elements.
- **Do** ensure every interactive element has visible focus (`ring-3 ring-ring/50`), hover, active (`translate-y-px`), disabled (`opacity-50`), and loading states.
- **Do** use 100-250ms transitions for state changes. Dropdown close: 100ms. Toast: default.
- **Do** follow `prefers-color-scheme` by default, with a manual override (`localStorage` key `orbitx_theme`) in Settings.
- **Do** write UI copy in Chinese (the app's primary locale), with clear, direct error messages.
- **Do** use skeleton placeholders for content loading states, never a lone spinner in an empty area.

### Don't:
- **Don't** use glassmorphism (`backdrop-blur`), gradient backgrounds, or gradient text anywhere in the application.
- **Don't** use border-radius larger than 8px anywhere. Large rounded corners read as playful, not precise.
- **Don't** use modal dialogs as the first solution. Exhaust inline expansion, collapsible sections, and progressive disclosure first.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on any element.
- **Don't** add decorative motion. Animation exists only to convey state change (dropdown open/close), feedback (toast arrival), loading (spinner), or reveal — never for visual flair.
- **Don't** use display fonts, brand typefaces, or decorative letterforms in UI labels, buttons, or data contexts.
- **Don't** ship components with missing states. Every interactive element needs default, hover, focus, active, disabled, and loading variants.
- **Don't** exceed 5% accent color coverage on any screen. If you can see the blue without looking for it, there's too much.
- **Don't** use Notion-style generous whitespace in data contexts. The data grid is a database GUI — compact, scannable, efficient.
- **Don't** use spinner-only loading states for content areas. Use skeleton placeholders that preserve layout geometry.
- **Don't** use `console.log` in frontend code. All logging routes through the Rust backend via the `logger.ts` bridge (`invoke('log_event', ...)`).
- **Don't** hardcode light or dark mode assumptions. Every color token must have a `.dark` counterpart in `globals.css`.
