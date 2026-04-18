# WebFVD — agent working agreement

A new browser-based force-vector roller-coaster design tool, drawing on two reference implementations: **FVD++** (altlenny/openFVD, C++/Qt, GPL-3.0) for physics and file format, and **KexEdit** (IndividualKex/KexEdit, Unity/C#, MIT) for UI and advanced features. We ship AGPL-3.0 — compatible with FVD++ under GPL-3.0 and adds the AGPL §13 network-use source-disclosure clause.

**Before doing anything: read `docs/webfvd-spec.md` once.** It's the source of truth. When this file conflicts with the spec, the spec wins. When both are silent, ask.

## The tier system — read this first

Everything in this project is tagged with a tier. Respect them.

- **T1** — MVP. A web FVD++ with modern UI. Ships at end of M10.
- **T2** — KexEdit-peer features: shuttles, bridges, multi-car rendering, optimizer, node graph. Ships at M16.
- **T3** — Modern coaster design: switch tracks, launches, magnetic brakes, overhang, rigid-body sim. Ships at M21.

**Don't skip ahead.** If you're working on a T1 milestone and reach for a T2 feature, stop. Defer it. The tier boundaries are ship points; the discipline keeps the project from drowning in scope.

## Context layers

- **Tier 0 (this file):** working agreement, global rules.
- **Tier 1:** `docs/webfvd-spec.md` — full spec. Read first. Reread the relevant section whenever you start new work.
- **Tier 2:** `packages/*/CONTEXT.md` — one per package, explaining purpose, key files, conventions. Create when you create the package; keep it current.
- **Tier 3:** code.
- **Reference:** `reference/openfvd/` (C++ physics truth) and `reference/kexedit/` (UX/docs reference). Both git-ignored. Clone them before starting.

## Golden rules

1. **Physics changes require golden-file tests.** If you touch `packages/core/src/physics/` without updating or adding a test under `packages/core/test/golden/`, the PR is wrong. Build the test harness first, integrator second.

2. **`packages/core` has zero runtime dependencies on the DOM, React, or Three.js.** It must run in Node. If an import from `react`, `three`, or a browser-only API appears in `core`, you've done the wrong thing. `gl-matrix` is the only math library in core; `Three.Vector3`/`Quaternion` never cross the core boundary.

3. **Recompute runs in the Web Worker. Always.** The main thread reads results via Comlink and transferable `ArrayBuffer`s. If you're about to call an integrator from a React component, stop.

4. **No literal user-facing strings in the app.** Every label goes through `t()`. Every new string lands in `packages/app/src/i18n/locales/en/*.json` _and_ `de/*.json`. If the DE translation is uncertain, add the key with a `// TODO(i18n-de): verify` comment — don't leave the DE file short.

5. **For T1 physics: match FVD++ 0.79 behavior, even when it looks wrong.** Port the math from `reference/openfvd/core/` verbatim. The `0.9 * heartLine` in energy calc is intentional. The off-by-one at section boundaries is intentional. Add `// NOTE: matches FVD++ 0.79` and move on. Byte-for-byte compatibility with FVD++ matters because NL1/NL2 expect it.

6. **For T2/T3 features (beyond FVD++): design deliberately, don't port.** Signed velocity, ReverseSection, switch tracks, launch sections have no FVD++ reference. Consult the spec and KexEdit docs; make decisions with reasoning in the PR description.

7. **One milestone per PR.** Defined in §19 of the spec. Milestones M7, M11, M20 are large — split by feature. Never batch two milestones.

8. **No history in code.** Don't write comments like "changed from X" or "previously was Y". Write the current state as if it always was.

9. **Privacy is a feature.** No telemetry, analytics, CDN calls, or third-party scripts. Ever. See spec §16.

## Stack (short form — full details in spec §2)

- TypeScript strict · Vite · React 18 · Zustand · Radix + Tailwind
- Three.js (rendering only) · gl-matrix (physics only)
- uPlot (value-over-time graphs) · custom SVG (timeline keyframe editor)
- TanStack Table (table view) · Comlink (worker RPC)
- Vitest · i18next · Zod · fast-check (property tests)

No MUI. No lodash. No moment. No axios. No date-fns (use Intl). Check whether a dep is needed before adding one.

## Repository map

```
packages/
  core/     — pure TS: model, physics, I/O. No DOM. Runs in Node.
  worker/   — Web Worker wrapping core via Comlink.
  app/      — React app. Everything UI-adjacent.
tools/
  fvd-dump/ — CLI reading .fvd → JSON + CSV node dumps (for goldens).
docs/
  webfvd-spec.md — the spec.
reference/  — git-ignored. openfvd/ and kexedit/ clones for reading.
```

## Navigation schemes (§6.4)

The 3D viewport has **three input contexts**, not one. This matters because WebFVD targets Mac laptop users, Windows desktop users, and tablet users — they expect different things.

- **Desktop 3-button mouse:** middle-drag pan, Shift+middle orbit, scroll zoom. Fusion 360 defaults.
- **Mac trackpad:** two-finger swipe pan, Shift+two-finger orbit, pinch zoom. Gesture-first; no modal right-click-hold (collides with Mac's two-finger-tap = right-click).
- **Laptop trackpad (non-Mac):** hybrid with Blender-style `G`/`R` keyboard fallback for weak trackpads.

Fly mode is `Tab` (works on any input device), not right-click-hold. ViewCube is the always-available universal fallback. Don't hardcode "click and drag" in gesture handlers — abstract through a scheme-dispatch layer.

## Dual-unit UI (§4.5)

- Internal storage, IPC, files: **SI always**. Meters, seconds, m/s, radians, g.
- UI: formatter reads user preference (metric-mps / metric-kph / imperial), formats on display, parses on input.
- `core` is locale-agnostic. Errors return codes, not strings. Translation is an app-layer concern.
- Decimal separators: accept both `.` and `,` on input. Display per `Intl.NumberFormat(locale)`.

## How to start a task

1. Identify which **milestone** the task belongs to (spec §19). If it spans more than one, split it.
2. Identify the **tier**. If you're on T1 and reaching into T2 scope, stop.
3. Read the relevant spec sections. Physics → §5 + the C++ file it ports. UI → §7. I/O → §8. Rendering → §6.
4. For physics or I/O: write the test first (golden input + expected output), verify it fails, then implement.
5. For UI: build on the schema-driven property pattern (§7.5), not hand-rolled panels.
6. Keep diffs small. One concept per commit.

## Conventions

- **Files:** `kebab-case.ts`. Type-only modules end in `.types.ts`.
- **Exports:** named, not default (tree-shaking, refactors).
- **Enums:** TypeScript `enum` for things that round-trip to `.fvd` with numeric values (see §4.1 — preserve exact numeric values). String union types for app-only states.
- **Numbers:** all internal math is `number` (float64). Wire-format conversions happen at I/O boundaries only. Float32Array for node SoA (memory + transferable).
- **Allocations in hot paths:** avoid. `gl-matrix` takes out-params; use them. No `new Vector3()` inside the integrator loop. `SubFunc.getValue` is called millions of times per recompute — keep it allocation-free.
- **Errors:** throw `WebFvdError` with a `code` (translation key). Never throw raw strings. Never translate in core.
- **Tests:** co-located as `foo.test.ts` next to `foo.ts`. Golden files under `packages/core/test/golden/`.
- **Commits:** imperative, scoped. `core: port quartic subfunction` not `Fixed bug`.

## Subtle traps (§21)

- **Don't port `qcustomplot`.** It's 25k lines of Qt charting. uPlot + custom SVG cover it in ~1200 lines.
- **Don't modernize the physics.** Fixed 1000 Hz Euler is intentional (NL2 export compatibility). No RK4, no adaptive stepsize.
- **Don't assume velocity is positive.** T2 introduces signed velocity (§6.6). When porting or touching integrators, ask: "does this handle v < 0?"
- **Don't confuse spatial and chronological position.** For forward-only coasters they're identical; shuttles make them diverge. The playhead is _chronological_.
- **Don't pre-optimize scrubbing.** `cumulativeTime`/`cumulativeDistance` arrays (§5.4) give O(log n) scrubs. 60k nodes × binary search per frame is free; skip the indexing cleverness.
- **Don't show a loading spinner for recompute.** At target perf it's <100 ms. A spinner that flashes briefly looks like jank. Show progress only if >500 ms.

## When unsure

- On T1 physics behavior → `reference/openfvd/core/`. It's the truth. Match byte-for-byte.
- On T2/T3 features → spec + KexEdit docs (`reference/kexedit/docs/`). Design deliberately; write reasoning in PR.
- On UI interaction → KexEdit timeline and node-graph references are the template.
- On spec interpretation → ask. Don't guess and ship.
- On scope → default to "defer to next tier."

## Security

- No secrets in repo. No API keys. There are no servers; there are no keys.
- Validate all file inputs (`.fvd`, `.webfvd.json`, CSV). Malformed input produces a structured error, not a crash.
- Sanitize any user-supplied text that ends up in the DOM (project names, section names). Use React's default escaping; don't `dangerouslySetInnerHTML`.
- `.fvd` reader: use `DataView`, not raw `ArrayBuffer` slicing. Bounds-check every read.
