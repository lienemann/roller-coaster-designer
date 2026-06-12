# fvd-oracle — bit-level parity oracle for the FVD++ float-emulation campaign

Compiles the **real** `reference/openfvd/core` physics (Qt stubbed out)
with the same floating-point model as the shipped FVD++ 0.79 Windows
binary, and exposes it as a CLI that loads `.fvd` files and emits ground
truth for `packages/core`'s integrator port.

## The toolchain truth (established by this tool)

`reference/openfvd/bin/win64/FVD.exe` — the binary that produced every
NL2 gold in `packages/core/test/golden/` — is:

- **x86-64** (PE32+), built by **MSYS2 MinGW-w64 GCC 6.2.0**, **Qt 5.6.2
  static**, late 2016.
- Therefore **SSE2 math, `FLT_EVAL_METHOD == 0`**: every float operation
  rounds to float32, every double operation to float64, no x87 extended
  precision anywhere. (The campaign's earlier "MinGW i686 / x87 80-bit"
  model was wrong — it was inferred, never checked against the binary.)
- glm version ≈ **0.9.8.0** (measured: with 0.9.8.0/0.9.8.5 several
  corpus files certify bit-exactly; 0.9.5.x/0.9.6.x do not).
- Source identity: repo master == the `16120df` "FVD++ 0.79 Windows
  Deployment" commit for everything except `secnlcsv` (CSV import) and
  GUI files.

On SSE2 the arithmetic is bit-determined by the source — compiler
version (gcc 6 vs 13) and optimization flags do not change results
(measured). The only remaining free variable is **libm**.

## Usage

```
make                      # needs ../../reference/openfvd + ../../reference/glm (tag 0.9.8.0)
./fvd-oracle dump   file.fvd            # per-node float fields as hex bit patterns
./fvd-oracle nl2    file.fvd 2.0        # NL2 element export (compare against golds)
./fvd-oracle resave file.fvd out.fvd    # load → save byte oracle
```

The TS-side consumer is `packages/core/scripts/node-diff.ts`: it runs
our integrator chain on the same `.fvd`, parses a `dump`, and reports
the first diverging float32 field per section plus the stitched subfunc
startValues (the anchor quantities).

## Certification status (vs FVD++-authored golds, glibc libm)

| file | maxAbs |
|---|---|
| geo-degree-roll | **bit-exact** |
| geo-length-threshold | **bit-exact** |
| geo-freeform-only | **bit-exact** |
| geo-trig-isolation | 0.04 mm |
| geo-arg1 | 0.11 mm |
| geo-multisub | 0.30 mm |
| geo-kinematics | 0.47 mm |
| geo-options | 22.1 mm |
| geo-degree-pitch | 22.7 mm |
| geo-degree-yaw | 26.6 mm |
| geo-warp | 26.8 mm |

The residual cluster is libm: a MinGW-w64 binary takes float variants
(`sinf`, `cosf`, `atan2f`, `asinf`, …) from statically-linked
libmingwex — which on x86-64 still implements many of them in x87
assembly — and double variants from the 64-bit `msvcrt.dll` (closed
source, SSE2, ~1 ulp from glibc). Those ulp-level differences amplify
through the section-anchor mechanism (`translateValues(fYawFromLast ×
F_HZ)`) into the 20-mm-class drift. Next steps, in order:

1. Vendor the 2016-era mingw-w64 (v5.x) math sources for the float
   variants into `libm-model.cpp` and re-certify.
2. For the msvcrt doubles, capture a probe table on a real Windows
   machine (tiny program printing `sin/cos/atan2/asin/exp/pow/sinh`
   bit patterns over the integrator's argument ranges) and fit.
3. Once all 11 files certify ≤0.1 mm, `dump` is bit-grade ground truth
   for every node — then re-derive `packages/core/src/fvd` rounding as
   per-op SSE2 semantics, validating each function with `node-diff.ts`.

## Layout

- `stubs/` — minimal Qt class stand-ins and GUI shims. Two are
  load-bearing, not just compile fodder: `QTreeWidgetItem` stores
  per-column text (smooth names round-trip through it), and
  `trackwidget.h` mirrors `sectionHandler` + `trackWidget::addSection`
  + `updateAnchorGeometrics` (which mutates the anchor node).
- `secnlcsv-stub.cpp` — NoLimits-CSV sections abort if exercised (none
  exist in the parity corpus).
- `libm-model.cpp` — the libm selection under test; certification
  against the golds is the arbiter for every choice in it.
- `-DNDEBUG` matters: the release binary compiles glm asserts out and
  lets negative `sqrt` arguments produce NaN (geo-options exercises
  this).
