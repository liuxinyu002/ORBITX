# Dashboard

## Purpose

Define the tool lobby Dashboard: responsive grid layout, configuration-driven tool cards, settings entry point, and visual design constraints aligned with the design token system.

## ADDED Requirements

### Requirement: Responsive grid layout
The Dashboard SHALL use a CSS grid layout with breakpoint-responsive columns: `grid-cols-1` on mobile, `md:grid-cols-2` on tablet, `lg:grid-cols-3` on desktop. The grid SHALL have `gap-6` spacing and `p-6` padding.

#### Scenario: Desktop layout shows 3 columns
- **WHEN** the viewport width is >= 1024px (lg breakpoint)
- **THEN** tool cards SHALL render in 3 columns

#### Scenario: Tablet layout shows 2 columns
- **WHEN** the viewport width is between 768px and 1023px (md breakpoint)
- **THEN** tool cards SHALL render in 2 columns

#### Scenario: Mobile layout shows 1 column
- **WHEN** the viewport width is < 768px
- **THEN** tool cards SHALL render in a single column

### Requirement: Configuration-driven tool cards
The Dashboard SHALL define a `toolCards` configuration array where each entry has `{ title: string, description: string, route: string, icon: LucideIcon }`. Cards SHALL be rendered by mapping over this array rather than hardcoding each card in JSX.

#### Scenario: Cards rendered from configuration
- **WHEN** the Dashboard renders
- **THEN** the number of rendered cards SHALL equal the length of the `toolCards` array

#### Scenario: Adding a new tool
- **WHEN** a developer adds a new entry to the `toolCards` array
- **THEN** a new card SHALL appear on the Dashboard without requiring JSX changes

### Requirement: Card visual design
Each tool card SHALL use the following Tailwind classes:
- Base: `shadow-sm ring-1 ring-foreground/10 rounded-lg bg-white`
- Hover: `shadow-md -translate-y-0.5 transition-all duration-200`

Cards SHALL NOT use glassmorphism effects, gradient highlights, or unconventional border styles.

#### Scenario: Card hover effect
- **WHEN** the user hovers over a tool card
- **THEN** the card SHALL elevate (`shadow-md`) and shift up slightly (`-translate-y-0.5`) with a smooth transition

### Requirement: Header layout
The Dashboard SHALL render a Header area containing:
- Left: "OrbitX" brand title
- Right: Settings `IconButton` (Lucide `Settings` icon) navigating to `/settings`

The IPC status indicator (debug artifact) SHALL NOT be rendered in the Dashboard header.

#### Scenario: Settings button navigates to settings
- **WHEN** the user clicks the Settings icon in the Dashboard header
- **THEN** the app SHALL navigate to `/settings`

#### Scenario: No IPC status indicator
- **WHEN** the Dashboard renders
- **THEN** no IPC connection status element SHALL be visible
