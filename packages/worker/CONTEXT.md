# packages/worker — CONTEXT

Web Worker wrapper around `@roller-coaster-designer/core`. Ships the physics
recompute off the main thread (CLAUDE.md rule 3: "recompute runs in the Web
Worker. Always.").

## Purpose

- Expose a typed RPC surface (`PhysicsWorkerApi`) via Comlink.
- Own the `MNode` SoA (Float32Array) lifecycle.
- Return results to the main thread as **transferable** `ArrayBuffer`s; no
  structured-clone copies of node streams.

## Current state (M3)

`TrackStream` now carries five Float32Arrays per track: `positions` (3·N),
`velocity` (N), `forceNormal` (N), `forceLateral` (N), `cumulativeTime` (N).
Every buffer transfers across postMessage without a structured-clone copy.

## Current state (M2)

Two RPC methods exposed via Comlink:

- `ping(value)` — sanity round-trip, kept from M0.
- `recompute(project): Promise<RecomputeResult>` — runs `integrateProject`
  from `@roller-coaster-designer/core` and returns one `TrackStream` per
  track. Each stream carries a `Float32Array` of packed XYZ positions plus
  the section-start node indices. The positions buffer transfers to the
  main thread via Comlink's `transfer()` helper so the main thread ends up
  with a view on the same `ArrayBuffer`, no copy.

The `sideEffects: false` flag is intentionally absent on this package: the
`expose(api)` call at module scope is the side effect that matters, and
bundlers must preserve it.

## Build

- `tsconfig.json` `lib: ["ES2022", "WebWorker"]` — `self` typed as
  `DedicatedWorkerGlobalScope`.
- `vite.config.ts` in `packages/app` imports this worker through Vite's native
  worker handling (`?worker` suffix) — no separate bundler step.

## Conventions

- The worker owns node-stream memory. Main thread receives views on transferred
  buffers, never writes back into them.
- Any API method that returns arrays must transfer their `ArrayBuffer`s. See
  §1.5 of the spec.
