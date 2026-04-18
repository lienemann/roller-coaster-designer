# packages/worker — CONTEXT

Web Worker wrapper around `@roller-coaster-designer/core`. Ships the physics
recompute off the main thread (CLAUDE.md rule 3: "recompute runs in the Web
Worker. Always.").

## Purpose

- Expose a typed RPC surface (`PhysicsWorkerApi`) via Comlink.
- Own the `MNode` SoA (Float32Array) lifecycle.
- Return results to the main thread as **transferable** `ArrayBuffer`s; no
  structured-clone copies of node streams.

## Current state (M0)

One stub method: `ping(value) => value`. Just enough to prove the build target
and the Comlink wiring in later milestones. Real API surface lands at M2 with
the first integrator.

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
