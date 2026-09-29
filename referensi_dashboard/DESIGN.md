---
name: Hydrological Cartography
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#3f4850'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#707881'
  outline-variant: '#bfc7d2'
  surface-tint: '#006398'
  primary: '#006194'
  on-primary: '#ffffff'
  primary-container: '#007bb9'
  on-primary-container: '#fdfcff'
  inverse-primary: '#93ccff'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#006947'
  on-tertiary: '#ffffff'
  tertiary-container: '#00855b'
  on-tertiary-container: '#f5fff6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cce5ff'
  primary-fixed-dim: '#93ccff'
  on-primary-fixed: '#001d31'
  on-primary-fixed-variant: '#004b73'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
  data-metric:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
---

## Brand & Style
The design system reflects technical precision, hydro-geological clarity, and public civic trust. Built for civic cartography, environmental monitoring, and field navigation across Greater Bandung, the interface pairs the crisp utility of scientific data visualization with an approachable civic health dashboard.

The aesthetic blends **Modern Technical Minimalism** with **Atmospheric Hydrology**. Translucent structural panels evoke pure water bodies and depth layers, while high-contrast metric chips provide uncompromised situational awareness over satellite, topographic, and vector basemaps. The visual tone is clinical yet optimistic—instilling instant confidence in water potability, microbiological safety, and civic infrastructure availability.

## Colors
The color hierarchy is derived directly from aquatic physics, filtration stages, and environmental cartography:

- **Primary Sapphire (`#0284C7`, deep `#0369A1`):** Represents municipal supply lines, flow vectors, primary GIS waypoints, and primary interactive controls.
- **Secondary Natural Teal (`#0D9488`):** Denotes natural springs, artesian wells, hydrological conservation basins, and environmental watershed zones across North and South Bandung.
- **Tertiary Certified Emerald (`#10B981`):** Reserved exclusively for verified drinkable status, lab-certified potable taps, and optimal water quality metrics (pH 6.5–8.5, low TDS).
- **Cyan Accent (`#06B6D4`):** Used for micro-interactions, telemetry pings, live sensor pulses, and filtration pathway indicators.
- **Deep Slate Canvas (`#0F172A` & `#1E293B`):** Forms dense UI anchor points, map control toolbars, night-mode overlays, and deep contrast text tokens for daylight outdoor legibility.
- **Diagnostic Alerts:** Amber (`#F59E0B`) indicates maintenance required or threshold warnings; Crimson (`#EF4444`) strictly designates non-potable or contaminated raw sources.

## Typography
The system employs a dual-typeface strategy tailored for analytical geographic workflows:

- **Display & Section Titles:** `Plus Jakarta Sans` delivers geometry, modern authority, and humanist warmth for regional headlines (e.g., Bandung Timur, Cibeunying, Cimahi Selatan).
- **Body & Data Dense Readouts:** `Inter` handles interface copy, coordinates, filter states, and technical lab records. Its tall x-height and distinct numerals guarantee immediate legibility during variable sunlight field inspections.
- **Tabular Figures & Metrics:** For chemical readouts (mg/L TDS, standard pH scales, flow rate in L/s), enable font-variant tabular figures (`font-variant-numeric: tabular-nums`) to prevent horizontal jitter during real-time telemetry streaming.

## Layout & Spacing
The layout follows an **App-Canvas Hybrid Model**:

- **Map Canvas Base:** Unbounded 100vh viewport container handling WebGL vector tiles and satellite orthophotos.
- **Overlay Floating Architecture:** Floating sidebar navigation and dynamic data cards employ absolute/fixed positioning with strict margin offsets (`margin-md` on tablet, `margin-lg` on desktop).
- **Desktop (1024px+):** Collapsible 380px analytical sidebar on the left, floating filter pill cluster top-center, and persistent spatial telemetry minimap bottom-right.
- **Tablet (768px - 1023px):** 320px sidebar dock or drawer mode; map controls collapse to stacked iconography with 8px (`space-sm`) gaps.
- **Mobile (<768px):** Bottom sheet modal paradigm (`snap-to-height` tiers at 15%, 50%, and 90% screen height) preserving high-value viewport visibility for direct map interaction.

## Elevation & Depth
Elevation is expressed through **Hydrological Layering**—a blend of optical glassmorphism and deep tinted oceanic shadows rather than flat mechanical greys.

- **Level 0 (Map Surface):** Raw cartographic basemap.
- **Level 1 (Docked Panels & Base Cards):** Background `rgba(255, 255, 255, 0.92)` with `backdrop-filter: blur(12px)`, bordered by a 1px ghost boundary of `rgba(15, 23, 42, 0.08)`. Shadow: `0 4px 20px -2px rgba(15, 23, 42, 0.06)`.
- **Level 2 (Floating Popups & Active Map Pins):** Background `#FFFFFF`, shadow: `0 12px 32px -4px rgba(2, 132, 199, 0.12), 0 4px 12px -2px rgba(15, 23, 42, 0.08)`.
- **Level 3 (Modal Dialogs & Lab Certificate Drawers):** Background `#FFFFFF`, shadow: `0 24px 48px -8px rgba(15, 23, 42, 0.22)`.
- **Map Control Floating Buttons:** Compact pill surfaces with high blur (`backdrop-filter: blur(16px)`), giving tactile separation from shifting satellite terrain below.

## Shapes
A consistent radius scalar of `2 (Rounded)` creates balanced, organic curvature reminiscent of fluid surfaces while retaining crisp geometric edges for scientific tables.

- **Micro Badges & Sensor Chips:** 6px radius for compact data containment.
- **Standard UI Cards & Filter Modules:** 8px (`rounded-md`) to 16px (`rounded-lg`) for clean compartmentalization.
- **Map Floating Action Buttons & Quick Filter Tags:** Fully pill-shaped (`9999px`) to visually differentiate transient tactile triggers from structural content panels.

## Components

### Buttons
- **Primary Cartographic Action:** Sapphire base (`#0284C7`), white bold text, subtle inner border highlight (`inset 0 1px 0 rgba(255,255,255,0.2)`). Hover transitions smoothly to `#0369A1` with an interactive elevation lift.
- **Secondary Environmental Action:** Ghost surface with `#0D9488` border and text, shifting to a soft teal tint (`rgba(13, 148, 136, 0.08)`) on interaction.
- **Map Controls (Zoom, Pan, Layer Toggle):** Square-rounded (40x40px, `rounded-lg`) white surfaces with `#0F172A` iconography, featuring tactile active states with slate border emphasis.

### Chips & Filter Pills
- **Filter Toggle Pills:** Oval capsules with icon prefixes (e.g., Spring, Tap, PDAM, Depot). Inactive: transparent slate border with low-opacity text. Active: filled `#0284C7` with white text and a glowing drop shadow.
- **Status Badges:**
  - *Air Siap Minum (Lab Verified):* Emerald container (`#ECFDF5`), emerald text (`#065F46`), leading checkmark icon.
  - *Air Bersih (Sanitasi/MCK):* Cyan container (`#CFFAFE`), primary blue text (`#0369A1`).
  - *Dalam Uji Kelayakan:* Amber container (`#FEF3C7`), amber text (`#92400E`).

### Geospatial Feature Cards
- **Header:** Location name, Bandung administrative tag (e.g., *Cimenyan, Kab. Bandung*), and immediate potability status pill.
- **Metric Grid:** 3-column micro-dashboard within the card displaying:
  1. *TDS Level:* (e.g., `42 ppm`) with an inline safety spectrum bar.
  2. *pH Balance:* (e.g., `7.2`) with neutral-zone indicator.
  3. *Debit Air:* (e.g., `1.8 L/s`).
- **Verification Footer:** Lab seal thumbnail, date of last biological sample inspection, and instant "Petunjuk Arah" (Routing) button.

### Form Inputs & Search Filter Dock
- **Geographic Autocomplete Input:** Embedded high-contrast search bar featuring real-time coordinate parsing, district quick-filters, clear button, and GPS locate trigger. Border transitions from neutral slate (`#CBD5E1`) to radiant sapphire (`#0284C7`) on focus with an ambient outer glow.
- **Checkboxes & Multi-select Toggles:** Custom rounded squares (`rounded: 4px`) tinted with primary sapphire and pure white vector tick indicators.