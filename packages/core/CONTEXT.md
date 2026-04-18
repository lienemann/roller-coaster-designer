# packages/core — CONTEXT

Pure TypeScript. Zero runtime dependency on the DOM, React, or Three.js. Runs
in Node. Publishable as a standalone npm package (spec §3).

## Purpose

Everything that is not UI:

- Data model (`src/model/`) — ports of openFVD's `core/` C++ headers.
- Physics (`src/physics/`) — integrators per section type.
- Smoothing (`src/smoothing/`) — port of `smoothhandler.cpp`.
- I/O (`src/io/`) — JSON, legacy `.fvd`, NL1, NL2, NL2 CSV.
- Math helpers (`src/math/`) — `gl-matrix` wrappers, splines, quaternion helpers.

Ships as `@roller-coaster-designer/core`.

## Package rules

- **No DOM imports.** ESLint `no-restricted-imports` enforces this. The
  `tsconfig.json` omits `DOM` from `lib`.
- **No React, no Three.js.** Same mechanism.
- **Only `gl-matrix` for physics math.** Three.js `Vector3`/`Quaternion` never
  cross into this package.
- **Float32Array for node SoA.** Transferable across the worker boundary
  without copies.
- **Errors are structured.** Throw `WebFvdError` with a `code` (translation
  key); never a raw string. Translation happens in the app layer.
- **No hot-path allocation.** `gl-matrix` out-params only inside integrators.

## Current state (M2)

- `src/physics/subfunc-eval.ts` — `getSubFuncValue(subFunc, x)` with the
  Linear branch filled in. Every other degree throws loudly; the full nine
  land at M3. `applyCenter`/`applyTension` are placeholders returning
  identity.
- `src/physics/integrate.ts` — `integrateTrack(track)` walks sections in
  order and produces an `MNodeArrays` populated with positions, basis
  vectors, velocity, roll, and projected g-forces. Anchor + Straight only;
  every other section type throws. Right-handed Y-up basis with
  `norm = cross(lat, dir)` — the viewport and worker share this convention.
  Scratch vec3 buffers live at module scope so the hot loop doesn't allocate.
- `gl-matrix` is now a runtime dep. Only `vec3` is used today.

## Current state (M1)

- `src/model/` — full TypeScript port of the openFVD data model: `enums`,
  `constants`, `mnode` SoA container, `subfunction`, `function`, `section`
  (discriminated union over all seven `SecType` variants), `track`, and
  `project`. Shape-only at M1; integration logic lands at M2+.
- `src/errors.ts` — `WebFvdError` plus a `WEBFVD_ERROR_CODES` catalogue.
  Every code has matching EN + DE translations in
  `packages/app/src/i18n/locales/`.
- `src/io/json/` — Zod schema (`z.discriminatedUnion` on `SecType`), a
  probe-first reader that dispatches migrations before full validation, a
  deterministic stable-key-order writer, and a migrations registry seeded
  with `CURRENT_VERSION = 1`.
- `test/golden/minimal-straight.webfvd.json` — hand-crafted minimal project
  asserted byte-for-byte against `stringifyWebFvdJson` output. Listed in
  `.prettierignore` so formatter runs don't wreck the round-trip.

## Test policy

- Unit tests co-located as `foo.test.ts` next to `foo.ts`.
- Golden tests under `test/golden/`, input `.fvd` + expected node-stream CBOR.
- Tolerance for golden comparison: `1e-4` on position, `1e-5` on forces.

## Ports in progress

| Module                                      | Upstream source                                                       | Status |
| ------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `model/*`                                   | `reference/openfvd/core/{section,subfunction,function,track,mnode}.h` | M1     |
| `physics/straight.ts`                       | `core/section.cpp` (Straight branch)                                  | M2     |
| `physics/curved.ts`                         | `core/section.cpp` (Curved branch)                                    | M3     |
| `physics/forced.ts`                         | `core/secforced.cpp`                                                  | M4     |
| `physics/geometric.ts`, `physics/bezier.ts` | `core/section.cpp` (Geometric / Bezier)                               | M5     |
| `smoothing/*`                               | `core/smoothhandler.cpp`                                              | M6     |
| `io/fvd/*`                                  | binary reader/writer matching FVD++ 0.79                              | M9     |
| `io/nl1/*`, `io/nl2/*`                      | `core/exportfuncs.cpp`, `core/track.cpp`                              | M10    |

See `docs/webfvd-spec.md` §4 and §5 for full port targets.
