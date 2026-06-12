# roller-coaster-designer

A browser-based roller-coaster design tool. You shape the forces the rider
feels; the integrator works out the track geometry that delivers them.
Inspired by, and intended to be a modern successor to,
[FVD++](https://github.com/altlenny/openFVD) — Christian Lenhart's
force-vector designer that pioneered this style of editing — with UI ideas
borrowed from [KexEdit](https://github.com/IndividualKex/KexEdit).
Runs entirely in the browser.

**▶ Try it now: <https://lienemann.github.io/roller-coaster-designer/>**
(stable build, deployed from `main`). The latest feature-branch build
lives at
[`/staging/`](https://lienemann.github.io/roller-coaster-designer/staging/).

Status: pre-release. The full specification and milestone plan are in
[`docs/webfvd-spec.md`](docs/webfvd-spec.md); start there if you're
reading the code.

## Quickstart

Node 20+ (`.nvmrc`) and pnpm 9+.

```bash
corepack enable
pnpm install
pnpm --filter app dev          # http://localhost:5173
pnpm verify                    # lint, typecheck, test, build
```

## Layout

```
packages/
  core/      Data model, physics, file I/O.
             DOM-free; runs in Node.
  worker/    Web Worker wrapping core via Comlink.
  app/       React PWA. Viewport, graphs, panels, state, i18n.
tools/
  fvd-dump/  CLI: read a .fvd file, emit JSON or per-node CSV.
docs/
  webfvd-spec.md         Source of truth.
  fvd-binary-format.md   Byte-level spec of the legacy .fvd format.
```

Round-trips `.webfvd.json` (native) and `.fvd` (legacy binary); exports
NoLimits 2 CSV for downstream rendering. No telemetry, no third-party
scripts, no server side.

## Integrator compatibility with FVD++

The default *compat mode* doesn't just approximate FVD++ — it chases the
shipped binary's floating-point behavior bit by bit, so a `.fvd` whose
track ends were carefully matched in FVD++ keeps them here. The
reference is the official FVD++ 0.79 Windows distribution (`FVD.exe`,
x86-64), built with MSYS2 MinGW-w64 **GCC 6.2.0**, **Qt 5.6.2** (static)
and **glm ≈ 0.9.8.0** — SSE2 floating point throughout
(`FLT_EVAL_METHOD == 0`), with float math from the statically linked
mingw-w64 runtime and double math from the 64-bit `msvcrt.dll`. We
verify against outputs of that exact binary on two levels: NL2-element
exports compared float-by-float against FVD++-authored golds, and a
byte-level oracle on `.fvd` files FVD++ itself saved. The campaign log
lives in [`docs/parity-campaign.md`](docs/parity-campaign.md), and
[`tools/fvd-oracle/`](tools/fvd-oracle/) rebuilds the original C++ core
under the same floating-point model to generate per-node ground truth.
A separate *precise mode* runs the same integrator in float64 for
cleaner numerics at the cost of FVD++ parity.

## License

[AGPL-3.0-only](LICENSE). Modified versions — including network-hosted
ones — must offer their source under the same terms. See
[`NOTICE`](NOTICE) for full upstream attribution.
