# Product

## Register

product

## Users

Knowledge workers (recruiters processing resume libraries, analysts working with pricing tables, researchers extracting structured data) at their desks, in bright offices or late-night dim rooms. They select text, hit a hotkey, and expect instant, invisible extraction. The tool must never break their flow.

## Product Purpose

A privacy-first, air-gapped, local-first desktop efficiency toolbox. Extracts fragmented information into structured local databases via global hotkeys and system accessibility APIs. No accounts, no cloud storage, no telemetry. The tool exists to disappear into the task.

## Brand Personality

**Precise, Restrained, Invisible.**

- **Precise (精准)**: No ambiguous guidance anywhere. Data display, character count limits, and blocking prompts must be direct and unambiguous. Every number, label, and message earns its place.
- **Restrained (克制)**: Reject all non-essential visual noise. No gradients, no elaborate shimmer animations, no decorative elements. The interface says only what the user needs to know, then gets out of the way.
- **Invisible (无形)**: When not actively summoned, the tool is completely hidden (system tray only). Silent extraction communicates via a 2-second toast and nothing more. Never hijack the user's flow state.

## Reference Products

**Toward:**
- **Linear** — keyboard-first interaction, clear focus states, restrained motion. Every action available from the keyboard, no sluggish transitions.
- **Raycast** — command palette as primary interface. Centered floating input, fade-out dropdown, fast dismissal.
- **TablePlus / Navicat** — data grid density. Compact rows, fixed column headers, efficient use of screen real estate. A modern lightweight database GUI, not a document editor.

**Away from:**
- Flashy "AI" web-app dashboards with glowing cards and gradient accents.
- Heavy glassmorphism (`backdrop-blur`), large border-radius (≥12px), neon color schemes.
- Notion-style generous whitespace in data contexts. OrbitX is a productivity tool, not a document canvas.
- Modal-first interaction patterns. Every interaction should prefer inline or progressive disclosure.

## Design Principles

1. **Disappear into the task.** Non-wake state is system tray only. Silent extraction is a 2-second toast. Never steal attention without cause.
2. **Precision over decoration.** Every element on screen serves the user's current task. Ambiguity is a bug. Directness is a feature.
3. **Native, not web.** The interface should feel like part of the operating system. System fonts, system theme, system-native affordances. No web-app artifacts.
4. **Density serves productivity.** The data grid is a workhorse — compact, scannable, information-rich. Treat it like a lightweight database GUI, not a blog layout.
5. **Keyboard-first.** Every primary action reachable from the keyboard. Focus states are always visible. Transitions are 150-250ms — fast enough to feel instant, long enough to register.

## Accessibility & Inclusion

- WCAG 2.1 AA minimum for all interactive surfaces.
- System theme following (`prefers-color-scheme`) with manual override (follow system / always light / always dark).
- Respect `prefers-reduced-motion`: disable all non-essential transitions and animations when set.
- Command palette input at minimum 16px to prevent unintended zoom on mobile/desktop and reduce visual fatigue.
- Focus indicators always visible, conforming to `:focus-visible` best practices.
