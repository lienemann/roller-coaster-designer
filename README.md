# roller-coaster-designer

A browser-based force-vector roller-coaster design tool. Sculpt the forces
the rider feels; the integrator produces the track geometry that delivers
them. Runs entirely client-side.

Status: pre-release, Tier 1 in progress. See
[`docs/webfvd-spec.md`](docs/webfvd-spec.md) for the spec and milestone plan.

## Design

- **Force-driven authoring.** Roll, normal and lateral g-loads are first-class
  functions of time or arc length; pose falls out of integration, not the
  other way round.
- **1 kHz Euler integration** in pure TypeScript. Energy-conserving on
  frictionless segments to within float32 drift; rollSpeed, force vectors,
  and arc length re-derived per recompute.
- **Hot-path discipline.** `packages/core` is DOM-free, runs in Node, and
  forbids React / Three.js imports at the package boundary; the integrator
  is allocation-free in its inner loop (gl-matrix out-params, SoA
  `Float32Array` columns).
- **Recompute off the main thread.** A Comlink-wrapped Web Worker owns the
  physics; the React tree only sees transferable `ArrayBuffer`s.
- **Native + legacy formats.** Round-trip `.webfvd.json` and FVD++ 0.77
  `.fvd` binary; export NoLimits 2 CSV.

## What it isn't

- Not a structural-analysis or certification tool — geometric forces and
  published-envelope checks are design aids, not stress reports.
- No terrain, scenery, scripting, or block-system simulation.
- No telemetry, accounts, analytics, third-party scripts, or server side.
  Files live on your disk; the PWA shell caches itself and nothing else.

## Quickstart

Requires Node 20+ (see `.nvmrc`) and `pnpm` 9+.

```bash
corepack enable
pnpm install
pnpm --filter app dev          # http://localhost:5173
```

Other scripts:

```bash
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm --filter app build
pnpm verify                    # all of the above
```

## Repository layout

```
packages/
  core/      Data model, physics integrators, file I/O. DOM-free, Node-runnable.
  worker/    Web Worker wrapping core via Comlink.
  app/       React PWA. Viewport, graphs, panels, state, i18n.
tools/
  fvd-dump/  CLI: read .fvd → JSON or per-node CSV trace.
docs/
  webfvd-spec.md         Source of truth.
  fvd-binary-format.md   Byte-level spec of the legacy .fvd format.
```

## Tests

`pnpm -r test` runs Vitest across all packages. Physics regressions are
caught by a JSON-snapshot golden harness (`packages/core/test/golden/`)
covering basic, advanced, corner-case and physical-invariant tracks.
Section transitions are exercised by a continuity test against five
deliberately wild fixtures; closures by a separate suite asserting both
boundary continuity and end-equals-anchor in all six rigid-body DoFs.

## License

[AGPL-3.0-only](LICENSE). Modified versions — including network-hosted
ones — must offer their source under the same terms; the §13 clause is
why we upgraded from FVD++'s GPL-3.0. See [`NOTICE`](NOTICE) for full
upstream attribution.
