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

## Current state (M0)

Empty except for `src/index.ts` which exports a version banner and a
declarative package-boundary marker. First real code arrives at M1 with the
data model.

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
