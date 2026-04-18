// SPDX-License-Identifier: AGPL-3.0-only

// Worker entry point — Vite picks this up via the ?worker import suffix in
// physics-client.ts and compiles it as a dedicated-worker module. The
// side-effect import wires Comlink's expose() inside the worker scope.
// Keeping the entry inside the app package (rather than importing
// @roller-coaster-designer/worker directly with ?worker) is what lets
// Vite's worker compiler discover the whole graph reliably — workspace
// symlinks and the ?worker suffix don't combine cleanly otherwise.
import '@roller-coaster-designer/worker';
