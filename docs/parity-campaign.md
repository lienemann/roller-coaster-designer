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

## Current parity baseline (post anchor/inline-extended campaign)

Max |Δ| over all emitted NL2 floats vs FVD++-generated golds, compat
mode, 2.0 m spacing, full section range. Measure with
`npx tsx scripts/parity-sweep.ts` from `packages/core` (prints this
table plus the testtrack gates). Previous-session values in brackets.

| file | drift | was |
|---|---|---|
| geo-freeform-only | 0.00 mm | 0.00 |
| geo-degree-roll | 0.10 mm | 0.10 |
| geo-multisub | 0.11 mm | 0.06 |
| geo-length-threshold | 0.28 mm | 0.02 |
| geo-trig-isolation | 0.47 mm | 7.31 |
| geo-options | 1.41 mm | 2.62 |
| geo-kinematics | 1.62 mm | 0.46 |
| geo-arg1 | 3.29 mm | 0.25 |
| geo-degree-pitch | 7.14 mm | 22.68 |
| geo-warp | 19.05 mm | 50.72 |
| geo-degree-yaw | 28.79 mm | 68.62 |

Sum 62.3 mm (was 153.2); worst file halved twice over. Four small
files regressed (multisub/length-threshold/kinematics/arg1) — this is
NOT noise, see "anchor quantization" below: their previous values were
lucky rounding coincidences of the old (wrong) semantics, and there is
no Pareto path through this landscape (measured: 2× greedy searches
over 14 semantic toggles from different bases converge to the same
config). The trade is deliberate and documented in the commit.

testtrack byte oracle: **2** diffs (was 5), both the low mantissa byte
of the SAME quantity — the forceLateral anchors of the two forced
sections = curved boundary node's `vLat.y`, ≈25 ULP after 2413 curved
roll steps. The forceNormal anchors became BIT-EXACT when F_G became
float32. testtrack peak vertex drift 1.41 mm (was 1.49), budget 2 mm.

Five corpus files still lack NL2 golds (user exports from FVD++):
bez-basic, bez-roll, mixed-all, smooth-roll, smooth-iter (checked this
session — not yet present in test/golden/data/fvd-corpus/).

## THE key mechanism discovered this session: anchor amplification

Geometric/forced sections re-anchor their functions at node 0:
`translateValues(lNodes[0].getYawChange())` = `fYawFromLast × 1000`.
The ×1000 amplifies ONE float32 ULP of the boundary node's heading
(≈3.8e-6° at 50° headings) into a ~4e-3 °/s rate offset applied to the
ENTIRE next section → integrated over ~1 s → tens of mdeg of heading
error → tens of mm at the end of the track. Consequences:

1. Per-file drift is dominated by a handful of QUANTIZED boundary
   flips, not by per-step accumulation. That's why single fixes move
   files chaotically by whole quanta, and why corpus maxAbs ≤ 0.1 mm
   requires the boundary node's `vDir` to match FVD++ BIT-EXACTLY —
   i.e. every per-step store's rounding decision must match.
2. The error turns on when |heading| crosses ~1 rad (the float32 ULP of
   the atan2 result grows) — measured as the "cliff" where
   geo-degree-yaw sections beyond yaw-quadratic start drifting at a
   constant rate per section.
3. Diagnosis tools: `scripts/section-yaw-budget.ts` (net yaw per
   section, gold vs ours — the sharpest instrument),
   `scripts/yaw-error-profile.ts` (per-vertex segment-direction error),
   `scripts/sampling-shift.ts` (rules out exporter node-selection as a
   cause; it WAS ruled out), `scripts/byte-oracle-map.ts` (maps
   testtrack byte diffs to structural fields — this is how F_G and the
   force anchors were cracked), `scripts/boundary-bisect.ts` /
   `scripts/force-bisect.ts` (bit-level candidate evaluation at one
   boundary).

## What was applied this session (all corpus+oracle gated, committed)

1. **Inline-extended `getPitch`/`getDirection` in `calcDirFromLast`**
   (`MNode.getPitchExt/getDirectionExt`): mnode.h:69-70 are header
   inlines — `atan2f(...)·180/F_PI` stays in the 80-bit register; only
   the atan2f/sqrtf CALLS round (mingw implements them as `(float)`
   casts of double libm); the diff rounds once at the member store.
   Also `asin`/`cos`/`sqrt` in the track-angle block are bare DOUBLE
   libm (the old libmAsinF/libmCosF frounds there were wrong).
   Biggest single mover: pitch 22.7→3.7 alone.
2. **`toRad` = deg × float32(0.0174532925199432958)** (TO_RAD/F_RAD,
   lenassert.h:30-32).
3. **`F_G` = float32(9.80665)** (lenassert.h:35) — with the
   counter-quirk that secgeometric.cpp:183/345 + secbezier.cpp:115 use
   the bare DOUBLE literal 9.80665 inside the energy sqrt
   (`G_ENERGY` in constants.ts). Validated by the byte oracle: took
   testtrack 5→2 diffs (forceNormal anchors now bit-exact).
4. **Cross-TU float-parameter rounding**: `Func.getValue(x)` /
   `getSubfunc(x)` round x at entry (function.cpp is its own TU; the
   `maxArgument >= x` subfunc selection is a knife-edge);
   `setRoll/changePitch/changeYaw` round their angle parameter.
5. **float32 member-store rounding** of `fEnergy`, `fVel`,
   `fRollSpeed +=` in sec-geometric, and the `fYawFromLast ∓ 360`
   wraps in calcDirFromLast.
6. **glm 0.9.5.1 normalize structure** in `vec3Normalize`: the dot
   rounds to float32 at the sqrtf parameter push and the sqrt result
   rounds at the return cast (inversesqrt = 1/sqrtf).
7. **Geometric force block uses bare double `cos`/`sin`** (was wrongly
   on the float32 Taylor shims; sec-curved already used Math.cos).
8. **Thomas-solve float32** in the NL2 exporter (track.cpp:813-846:
   a/b/c are QVector<float>, d is vec3 — every solve store rounds).

## Measured REJECTIONS (do not re-apply without new evidence)

- **F_PI → float32 π globally**: regresses chaotically (kinematics
  0.5→30, arg1 0.25→38, oracle 5→8). The constant is f32 in C++, but
  flipping all sites at once moves knife-edges; per-site evidence
  needed. (Note: in the diff `dirA·k − dirB·k` the constant nearly
  cancels — its true effect is via OTHER sites.)
- **glm 0.9.5.1 source form of quat·vec3** (`uv *= 2qw; uuv *= 2;
  v+uv+uuv`): WORSE than the committed grouping
  `v + f32(f32(uv·qw + uuv)·2)` — gcc SRA keeps the uv/uuv temporaries
  in registers, so the literal source stores don't exist in the binary.
- **mingw model `fround(sin(x))` for sinf/cosf**: worse than the f32
  Taylor shims (sum 71 vs 62) — i686 mingw sinf/cosf track x87
  fsin/fcos, not correctly-rounded double sin.
- **float32 dot inside `vec3Distance`**: neutral; left out.
- **per-op f32 in applyTension/applyCenter removal** (WARPEXT): neutral
  on its own, not part of the winning set. The committed per-op r()
  stays (re-measure if warp becomes the top offender again).
- Older established facts still hold: per-op float32 in
  `Subfunc.getValue` is wrong; `vec3RotateAxisGlm` internals validated
  by oracle; `setRoll` stays on Rodrigues (byte-oracle decided).

## THE PARITY ORACLE (tools/fvd-oracle) — read before anything else

The campaign now has a native ground-truth generator: the REAL
reference C++ compiled with the shipped binary's FP model, plus
`packages/core/scripts/node-diff.ts` to bit-diff our chain against its
per-node dump. Key facts it established (all measured):

1. **The x87 premise was wrong.** `bin/win64/FVD.exe` (which produced
   every gold) is x86-64 / SSE2 / FLT_EVAL_METHOD==0: float ops round
   to float32 PER OPERATION, doubles to float64, no 80-bit anything.
   The earlier "double-inner / round-at-return matches x87" results
   were fitting accidents. Long-term, the TS port's rounding model
   should be re-derived as per-op SSE2, function by function, validated
   with node-diff against oracle dumps.
2. On SSE2 the arithmetic is source-determined: gcc 6↔13, -O1/-O2,
   SRA flags, x87 control word — all produce identical exports.
   The ONLY free variables are glm version and libm.
3. **glm is ≈0.9.8.0** (Qt 5.6.2 / late-2016 era): with it the oracle
   certifies geo-degree-roll, geo-length-threshold, geo-freeform-only
   BIT-EXACTLY against the golds; trig-isolation 0.04 mm, arg1 0.11,
   multisub 0.30, kinematics 0.47. glm 0.9.5.1 (the version fvd.pro
   "tested with") exports measurably differently — the binary did NOT
   use it.
4. The remaining oracle residual (yaw 26.6 / warp 26.8 / pitch 22.7 /
   options 22.1 mm — one cluster) is libm: mingw-w64's libmingwex
   float routines (x87 asm even on x64 for several functions) and the
   closed-source x64 msvcrt doubles, both ~1 ulp from glibc, amplified
   by the section-anchor quantization. Next: vendor 2016-era mingw-w64
   math sources for the float variants; for msvcrt doubles, capture a
   probe table on a real Windows machine (ask the user — tiny exe that
   prints sin/cos/atan2/asin/exp/pow/sinh bit patterns).
5. `track::loadTrack` applies `trackWidget::updateAnchorGeometrics`,
   which MUTATES anchorNode.fPitchFromLast/fYawFromLast (zero for
   default anchors, so corpus-invisible — but our TS port lacks it
   entirely; port it when anchors with non-default forces matter).
6. The oracle's section node counts differ from ours by one at section
   boundaries (oracle s0 has 1156 nodes where we keep 1155 on
   testtrack) — investigate with node-diff; may be a port sequencing
   difference in updateTrack/disjoint handling.
7. geo-options crashes a DEBUG oracle build via a glm `sqrt(x<0)`
   assert — the release binary (NDEBUG) lets it produce NaN; the
   integrator path relies on that. Keep -DNDEBUG.

## Method notes for the next push

- The greedy toggle-search harness was `scripts/flag-search.sh`
  (deleted with the scaffolding; trivially recreated — env-flag the
  candidate sites in src, loop `parity-sweep`, sum mm + gates).
- Remaining oracle residual: curved boundary `vLat.y` ≈25 ULP after
  2413 setRoll(Rodrigues)+normalize steps in the curved section. The
  curved rotation chain (axis construction at sec-curved.ts:123-127,
  the `r(r(-fPureDirection*F_PI)/180)` double-round vs C++'s single
  round at the cosf call, vPos accumulation) is the prime suspect pool.
  Fixing it would zero the byte oracle.
- Remaining corpus ceiling: boundary-anchor quantization. To go below
  ~mm on yaw/pitch/warp, per-step `vDir` stores must match FVD++
  bit-for-bit through whole sections. Use section-yaw-budget on
  yaw-linear (already bit-clean!) vs yaw-quadratic (-35 µdeg ≈ a few
  ULP flips per 1000 steps) to bisect which per-step op still flips.
- geo-warp/pitch drift is partly LONGITUDINAL (drift-bias.ts) —
  velocity/length chain, not only heading.

## Architecture snapshot (unchanged from a3f605f notes)

- ONE model: `packages/core/src/fvd/` (1:1 C++ port) + `fvd/doc.ts`.
- Both integrator modes run the same chain; toggle =
  `setFloatPrecision` driven by `ProjectDoc.fvdCompatibilityMode`.
- Reference plumbing — CORRECTED (supersedes every earlier x87 note):
  the shipped binary `reference/openfvd/bin/win64/FVD.exe` is x86-64,
  MSYS2 MinGW-w64 GCC 6.2.0, Qt 5.6.2 static, glm ≈ 0.9.8.0 —
  SSE2 math, FLT_EVAL_METHOD == 0. See tools/fvd-oracle/README.md.

## Other open items (not this campaign)

- Five NL2 golds from the user (bez/mixed/smooth corpus files), then
  numerical gates for SecBezier + roll smoother.
- `src/fvd/smooth.test.ts:21` has a pre-existing typecheck error
  (`new Track('t', 1.1, 0, 0)` — stale constructor signature).
- Subfunc/graph editor rebuild against the doc model.
- `prefs.integratorModeNote` i18n (en+de) is stale.
- Deeper tooltips for the Preferences dialog (user wants the WHY).
- Browser-level verification of the rewritten app (jsdom only here).
- Special looping section type — may be FVD-incompatible by design.
- User wants the history squashed to ONE commit when quality is
  "FAANG level" — coordinate before rewriting main.
