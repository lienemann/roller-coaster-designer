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

## License

[AGPL-3.0-only](LICENSE). Modified versions — including network-hosted
ones — must offer their source under the same terms. See
[`NOTICE`](NOTICE) for full upstream attribution.
