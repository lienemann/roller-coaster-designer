# packages/app — CONTEXT

React PWA, everything UI-adjacent. Consumes `@roller-coaster-designer/core`
for data and physics via `@roller-coaster-designer/worker`.

## Purpose

- Renders the viewport (Three.js, lands at M7), the timeline (SVG, lands at
  M3/M4), and the panels (Radix primitives + Tailwind, land with their
  features).
- Owns translations, keyboard shortcuts, theme, preferences.
- Owns the undo/redo command log (spec §9) — the executor lives here because
  commands touch UI state.

## Current state (M0)

- App shell: top bar with title + EN/DE language switcher + three-pane
  placeholder layout.
- i18n wired via `i18next` + `react-i18next`. All six namespaces
  (`common`, `editor`, `sections`, `functions`, `export`, `errors`) are loaded
  for both EN and DE. Namespaces beyond `common` carry only a `placeholder`
  key until their features arrive.
- Zustand store declared with a single `ready` flag + command-log shape.
  Actions populate alongside the data model at M1.
- Tailwind + PostCSS + Autoprefixer wired. Dark theme is the default; a light
  mode toggle arrives with the preferences panel at M8.
- PWA `manifest.webmanifest` is present. Service worker and offline app shell
  land at M10.
- ESLint rule `no-restricted-imports` forbids `react` / `three` imports from
  `@roller-coaster-designer/core`; enforced by the package boundary.

## File organization (target; grows over milestones)

```
src/
├── main.tsx                # Boot: load i18n, mount React root
├── App.tsx                 # Top bar + layout shell
├── ui/                     # Generic Radix-based components
├── panels/                 # (M2+) Sections, properties, graphs
├── scene/                  # (M2+) Three.js viewport
├── graphs/                 # (M3+) uPlot + custom SVG timeline
├── i18n/                   # i18next init + locales/
└── state/                  # Zustand stores + command log
```

## Conventions

- **No literal strings in JSX.** Use `t()`. Add EN + DE on every key landing.
- **No default exports** (ESLint enforces).
- **No backend calls.** `fetch()` is for local files only (JSON/FVD load). No
  analytics, no CDN, no fonts from Google. System fonts only.
- **No synchronous recompute.** Physics goes through the worker, always.
