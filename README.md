# roller-coaster-designer

A browser-based force-vector roller coaster design tool. Design a coaster by
sculpting the forces you want riders to feel; the tool integrates a consistent
track geometry from them. Exports to NoLimits 1 and 2. Reads existing FVD++
`.fvd` files. Runs entirely in the browser — no backend, no accounts, no
telemetry.

Status: **pre-release, Tier 1 in progress.** See
[`docs/webfvd-spec.md`](docs/webfvd-spec.md) for the full specification and
milestone plan.

## Credits

This project stands on two shoulders and says so plainly.

- **[FVD++](https://github.com/altlenny/openFVD)** (Christian Lenhart et al.,
  GPL-3.0) is the physics and file-format ancestor. Every integrator here
  traces back to its C++. For Tier 1 we match FVD++ 0.79 output byte-for-byte
  so existing projects round-trip.
- **[KexEdit](https://github.com/IndividualKex/KexEdit)** (IndividualKex, MIT)
  is the UI and feature template — timeline curves, node graph, table view,
  shuttle support, bridges, optimizer. We design from its docs, not its code.

See [`NOTICE`](NOTICE) for the full attribution.

## License

[AGPL-3.0-only](LICENSE). If you distribute a modified version — or run one
as a network service that users interact with — your version must also be
offered under AGPL-3.0. Upgrading from FVD++'s GPL-3.0 to AGPL-3.0 keeps
compatibility with the upstream (AGPL-3.0 is a permitted combination for
GPL-3.0 code) while adding §13's network-use clause: a hosted version of
this tool must link to its source from the app itself.

## Quickstart

Requires Node 20+ (`.nvmrc`) and `pnpm` 9+ (enabled via corepack).

```bash
corepack enable
pnpm install
pnpm --filter app dev          # open http://localhost:5173
```

Other scripts:

```bash
pnpm -r lint                   # ESLint across all packages
pnpm -r typecheck              # tsc --noEmit across all packages
pnpm -r test                   # Vitest across all packages
pnpm --filter app build        # production build of the web app
```

## Repository layout

```
packages/
  core/      Pure TypeScript: data model, physics integrators, file I/O.
             Zero DOM, React, or Three.js imports. Runs in Node.
  worker/    Web Worker wrapping core via Comlink. Ships the physics off the
             main thread.
  app/       React app. Viewport, timeline, panels, i18n, state.
tools/
  fvd-dump/  CLI that reads .fvd and emits JSON / CSV node streams. Used to
             generate golden reference data from FVD++ outputs.
docs/
  webfvd-spec.md     Full specification. Source of truth.
reference/           Git-ignored. Manual clones of openFVD and KexEdit for
                     reading. See docs/webfvd-spec.md §22.
```

## Contributing

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md). One milestone per PR. Physics
changes require golden-file tests. No telemetry, no CDN dependencies, no
analytics — ever.

## Privacy

No analytics. No telemetry. No third-party scripts. No cookies beyond
`localStorage` for your preferences. Projects live on your disk; nothing leaves
your browser unless you export it. This is a feature, not a promise —
`docs/webfvd-spec.md` §16 makes it non-negotiable.
