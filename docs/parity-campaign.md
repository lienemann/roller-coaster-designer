# FVD++ parity campaign — session handoff

Status file for the next working session. Read this FIRST, then spec
§21's "FVD++ float-emulation campaign" entry, then start. Everything
here was measured, not guessed.

## Mission

`fvdCompatibilityMode` (default) must reproduce FVD++ 0.79's integrator
bit-for-bit enough that a loaded `.fvd`'s carefully matched track ends
do not visibly drift. The user has explicitly authorized reimplementing
libm if required. The precise float64 mode shares the same code path via
`setFloatPrecision('float64')` and must keep working.

## Current parity baseline (commit a3f605f)

Peak vertex drift vs FVD++-generated NL2 golds, compat mode, 2.0 m
segments, full section range. Measured by the snippet in "Tools" below.

| file | drift | dominant content |
|---|---|---|
| geo-freeform-only | 0.00 mm | wire-loss Freeform |
| geo-length-threshold | 0.02 mm | export thresholds |
| geo-multisub | 0.06 mm | multi-subfunc + locked tail |
| geo-degree-roll | 0.10 mm | per-EDegree roll sweeps |
| geo-arg1 | 0.25 mm | Quartic/Quintic/Plateau arg1 |
| geo-kinematics | 0.50 mm | velocity/time sweeps |
| geo-options | 2.83 mm | bOri × bSpeed × bArg matrix |
| geo-trig-isolation | 7.50 mm | Linear ↔ Sin/Plateau pairs |
| geo-degree-pitch | 25.07 mm | per-EDegree pitch sweeps |
| geo-warp | 58.40 mm | centerArg/tensionArg sweeps |
| geo-degree-yaw | 75.13 mm | per-EDegree yaw sweeps |

testtrack.fvd byte oracle: first write reproduces 1314/1319 bytes; the
5 diffs are low-mantissa bytes of integrator-stitched subfunc
startValues (≤20 ULP); save→load fixed point at pass 2. Test pinned in
`packages/core/src/fvd/roundtrip.test.ts`.

Five corpus files still lack NL2 golds (user exports from FVD++):
bez-basic, bez-roll, mixed-all, smooth-roll, smooth-iter.

## Established facts (do NOT re-derive)

1. **Reference platform**: FVD++ 0.79 official Windows binary ≈ MinGW
   i686, x87 FPU, `FLT_EVAL_METHOD == 2`, gcc -O2. Float expressions
   AND float locals live in 80-bit registers; rounding to float32
   happens only at memory stores (class members, arrays, spills) and
   non-inlined call boundaries. JS double is the working proxy for the
   80-bit intermediates.
2. **Per-op float32 ("SSE2 model") is wrong**: rewriting
   `Subfunc.getValue` polynomials with `Math.fround` per binary op
   regressed geo-arg1 0.25→16 mm and geo-kinematics 0.5→32 mm.
   The committed double-inner / round-at-return code matches x87.
3. **Two real source discrepancies remain un-applied** because each, in
   isolation, flips discrete integrator branches and makes the corpus
   chaotically worse:
   - `TO_RAD(a) = a * F_RAD` with `F_RAD = 0.0174532925199432958f`
     (lenassert.h:32) — a single multiply by an f32 constant. Our
     `toRad` computes `(deg · π64)/180`.
   - `F_PI` is the FLOAT literal `3.141592653589793f` →
     3.1415927410125732. Ours is `Math.PI`.
   Applying F_PI=π32 alone: yaw 75→37, warp 58→40, BUT kinematics
   0.5→32 and arg1 0.25→36 and testtrack bytes 5→8. The flips come
   from knife-edge branches: `|artificialRoll| >= 90` sign selection,
   per-section node-count thresholds, Curved lead-out break.
4. **`vec3RotateAxisGlm`** (glm angleAxis emulation: q at struct-store
   rounds, uv/uuv rounded once each, `libmSinSmall/CosSmall` f32-Taylor
   for sinf/cosf) is validated by testtrack at 1.4 mm — do not touch
   without full-matrix evidence. Per-op rounding inside its cross
   products regressed testtrack 18×. `setRoll` stays on Rodrigues —
   decided by byte oracle (GLM path oscillates, never reaches a
   save→load fixed point).
5. glm templated calls (`glm::atan`, `glm::sqrt` on floats) are FLOAT
   (sinf/atan2f); bare libm calls in core .cpp files (`cos`, `asin`,
   `exp`, `pow`, `sinh`, `fabs`, `sqrt`) are DOUBLE with promotion.
   mingw's libm on i686 uses x87 instructions (fsin/fcos/fpatan), which
   V8's Math.* approximates to within ~1 ULP — adequate so far.

## Method for the next push (agreed with user)

Single-constant fixes are banned. The campaign is simultaneous
correctness with bitwise bisection:

1. Build a node-level diff harness: for a corpus file, run our
   integrator and locate the FIRST node where any stored float field
   (vPos/vDir/vLat/fRoll/fVel/fDistFromLast…) deviates from what the
   NL2 gold implies (use `scripts/drift-profile.ts` to find the first
   diverging vertex, then instrument the section's update loop around
   the corresponding node index).
2. At that node, log the inputs of each expression in the C++ order
   (pitchChange, yawChange, artificialRoll, the angleAxis quat…) and
   compare bit patterns against hand-evaluated x87 semantics. Fix THAT
   site (with its true C++ promotion), re-run the FULL corpus +
   testtrack bytes, accept only Pareto improvements.
3. Apply the F_RAD / F_PI32 corrections TOGETHER with whatever
   branch-input fixes they require so knife-edges flip consistently —
   the evidence says they are right individually but interact.
4. Watch the suspects: secgeometric.cpp:133-167 (pitch/yaw/roll updates
   and EULER kicker), seccurved lead-in/out smoothstep, the `sign`
   selection, `getMaxArgument()*F_HZ+0.5` node counts.

## Tools

- Parity sweep (run from `packages/core` after `pnpm build:libs`):
  `node --experimental-strip-types -e "<see scripts/drift-profile.ts
  header or git log a3f605f message>"` — or just run
  `pnpm vitest run src/fvd/corpus` which logs per-file maxAbs.
- `packages/core/scripts/drift-profile.ts` — per-vertex drift with
  section attribution (run against dist with the sed-to-dist trick in
  its header comment).
- `packages/core/scripts/drift-bias.ts` — signed drift components.
- Byte oracle: `src/fvd/roundtrip.test.ts` (budget: ≤5 low-byte diffs).

## Architecture snapshot (post-unification, commit 3d5231e)

- ONE model: `packages/core/src/fvd/` (1:1 C++ port) + `fvd/doc.ts`
  (plain-JSON ProjectDoc the app/worker/file-IO exchange). The old
  `physics/ model/ smoothing/ ops/ io/` dual stack is deleted.
- Both integrator modes run the same chain; the toggle is
  `setFloatPrecision` driven by `ProjectDoc.fvdCompatibilityMode`.
- Closure = WebFVD extension, derives a 2-knot BEZ at build time,
  exports to .fvd as plain BEZ (compat-lint marks it).
- Doc layer is byte-transparent (oracle test in `fvd/doc.test.ts`).

## Other open items (not this campaign)

- Five NL2 golds from the user (bez/mixed/smooth corpus files), then
  numerical gates for SecBezier + roll smoother.
- Subfunc/graph editor rebuild against the doc model (old scaffold
  deleted in the unification).
- `prefs.integratorModeNote` i18n (en+de) is stale — the toggle is
  live now, not "diagnostic only".
- Deeper tooltips for the Preferences dialog (user wants the WHY).
- Browser-level verification of the rewritten app (no chromium in the
  usual container; jsdom tests only).
- Special looping section type (sideways-offset loop) — may be
  FVD-incompatible by design, mark via compat lint.
- User wants the history squashed to ONE commit when quality is
  "FAANG level" — coordinate before rewriting main.
