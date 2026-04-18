# WebFVD — Browser-based Force-Vector Coaster Designer

**Goal:** A modern browser-based coaster design tool combining the best ideas from FVD++ (altlenny/openFVD) and KexEdit (IndividualKex/KexEdit) into a single web application. This is not a straight port of either — it's a new tool that uses both as reference implementations, with modern coaster features that go beyond what either supports.

**Status:** Greenfield. Two reference implementations to clone and study:

- `altlenny/openFVD` (C++/Qt5, GPL-3.0) — the original FVD tool; ground truth for physics and file format.
- `IndividualKex/KexEdit` (Unity/C#, MIT) — modern FVD editor with node graph, multi-car trains, optimizer.

**License:** Our output is AGPL-3.0 (compatible with openFVD's GPL-3.0 upstream, adds AGPL §13 for hosted deployments). MIT code from KexEdit may be consulted for reference but not copy-pasted; reimplement concepts in our own code. Preserve openFVD copyright notices on any file whose logic is directly ported.

**Reference reading:** this document points you at specific files and line patterns in both repos. Never translate blindly. Read the source first, understand the intent, then write idiomatic TypeScript.

---

## 0. Capability tiers — read this first

This spec describes a large system. Shipping it all at once is unrealistic. Every feature in this document is tagged with a tier:

- **[T1]** — Minimum viable release. A web FVD tool that can open `.fvd` files, edit forced/curved/straight sections, render the track in 3D, play it back, and export to NL2. Roughly a port of FVD++ with a modernized UI. Ship target: first public release.
- **[T2]** — Useful release. Adds KexEdit-level functionality: node graph for topology (bridges, shuttles, copy-path), multi-car train rendering, optimizer, complete circuits, all section types including bezier. Ship target: second release.
- **[T3]** — Full vision. Modern coaster features beyond what FVD++ or KexEdit support: switch tracks, multi-launch, magnetic brakes with force curves, overhang geometry, dark-ride sync, rigid-body multi-car physics. Ship target: mature tool.

**Every milestone (§19) is labeled with its tier.** Every feature description in §4–§18 is labeled. Claude Code builds in tier order and ships at each tier boundary.

**This is the discipline that keeps the project from failing.** When working on T1, don't detour to build a T3 feature just because it's interesting. When planning T2, don't be tempted to slip T3 work in. Tier boundaries are ship points.

Where the tier of a feature is genuinely unclear (e.g., "which aspects of the node graph are T1 vs T2?"), the tag reads `[T1→T2]` meaning "ship a simplified form in T1, expand in T2." A separate row describes what each tier looks like.

---

## 1. Architectural principles

1. **Physics is the product.** Everything else is UI around a pure TypeScript module that, given a sequence of sections and an anchor, produces a list of 1000 Hz `MNode` samples. That module must not import React, Three.js, or anything that touches the DOM. It must run identically in Node (for tests), a Web Worker (for the app), and — eventually — a CLI.
2. **Single source of truth: the `Project` tree.** Rendering, graphs, exporters, and undo/redo all read from it. Nothing computes physics by itself.
3. **Recompute is incremental.** FVD++'s `updateSection(fromNode)` starts integration from a node index, not from the section start, because changing section 5 doesn't invalidate sections 1–4. Preserve this.
4. **No framework-coupled business logic.** React components dispatch actions; they don't own state. Use Zustand (or equivalent) with an explicit command/undo log — the existing `undoaction.cpp` already uses the command pattern and ports directly.
5. **Recompute runs in a Web Worker.** The UI thread must never block on integration. At 1000 Hz, a 60-second coaster = 60k nodes per track, and smoothing passes can add more. Transferable `ArrayBuffer`s for the node stream.
6. **Native format is JSON; `.fvd` is legacy I/O.** Save/load round-trips through JSON. `.fvd` read and write are separate modules that translate to/from the same in-memory model.
7. **i18n from line one.** No hard-coded user-facing strings in components. Every label goes through `t()`. Ship EN and DE.

## 2. Tech stack

- **Language:** TypeScript strict mode. No `any` without a comment justifying it.
- **Build:** Vite, ES2022 target.
- **UI:** React 18 + Zustand + Radix UI primitives + Tailwind. No MUI (too heavy, wrong aesthetic for this).
- **3D:** Three.js (r150+). Track mesh built from the node stream via custom `BufferGeometry`.
- **Math:** `gl-matrix` for the physics core (fast, stack-allocated, maps 1:1 onto glm). Three.js `Vector3`/`Quaternion` only for rendering, never physics.
- **Graphs:** `uplot` for speed/force/roll/flexion plots (handles 60k points at 60fps). For the **transition editor** (interactive Bezier keyframes), build a custom SVG component — uPlot can't do that.
- **Worker:** native Web Worker + Comlink for RPC.
- **i18n:** `i18next` + `react-i18next`. Namespaces: `common`, `editor`, `sections`, `functions`, `export`, `errors`.
- **Testing:** Vitest for the physics core, with golden reference files generated by running FVD++ 0.79 on known-good inputs.
- **Persistence (short-term):** File System Access API where available (Chromium), fallback to `<input type="file">` + download link. No backend in v1.
- **Distribution:** Static PWA. GitHub Pages or Cloudflare Pages.

## 3. Repository layout

```
webfvd/
├── packages/
│   ├── core/                   # Pure TS, no DOM. The physics + model + I/O.
│   │   ├── src/
│   │   │   ├── model/          # Project, Track, Section*, Func, SubFunc, MNode
│   │   │   ├── physics/        # Integrators per section type
│   │   │   ├── smoothing/      # port of smoothhandler.cpp
│   │   │   ├── io/
│   │   │   │   ├── fvd/        # binary .fvd read + write
│   │   │   │   ├── json/       # native format (versioned)
│   │   │   │   ├── nl1/        # .nlelem writer (exportfuncs.cpp)
│   │   │   │   ├── nl2/        # NL2 CSV + binary writer
│   │   │   │   └── nlcsv/      # NL2 CSV import
│   │   │   └── math/           # vector helpers, spline, quaternion wrappers
│   │   └── test/
│   │       └── golden/         # .fvd inputs + expected node streams as CBOR
│   ├── worker/                 # Web Worker wrapping core, Comlink RPC surface
│   └── app/                    # React app
│       ├── src/
│       │   ├── scene/          # Three.js track mesh, camera, POV mode
│       │   ├── panels/         # Properties, Sections, Graphs, Transitions
│       │   ├── graphs/         # uPlot wrappers + transition editor SVG
│       │   ├── i18n/           # locales/en.json, locales/de.json
│       │   └── state/          # Zustand stores + command log
│       └── public/
└── tools/
    └── fvd-dump/               # CLI: read .fvd, print node samples as CSV
                                # Used to produce golden reference data
```

Keep `core/` publishable as a standalone npm package. Someone will eventually want to script with it.

## 4. Data model (port targets)

The C++ headers under `core/` in openFVD are the ground truth. Port these as TypeScript types first, before any logic.

### 4.1 Enums (port verbatim, preserve numeric values for `.fvd` compat) **[T1]**

From `core/section.h`:

```typescript
export enum SecType {
  Anchor = 0,
  Straight = 1,
  Curved = 2,
  Forced = 3,
  Geometric = 4,
  Bezier = 5,
  NoLimitsCSV = 6,
}
```

From `core/subfunction.h`:

```typescript
export enum EDegree {
  Linear = 0,
  Quadratic = 1,
  Cubic = 2,
  Quartic = 3,
  Quintic = 4,
  Sinusoidal = 5,
  Plateau = 6,
  ToZero = 7,
  Freeform = 8,
}
```

From `core/function.h`:

```typescript
export enum EFuncType {
  Roll = 0,
  Normal = 1,
  Lateral = 2,
  Pitch = 3,
  Yaw = 4,
}
```

From `core/track.h`:

```typescript
export enum TrackStyle {
  Generic = 0, // 0.5m
  GenericFlat = 1, // 0.7m
  Vekoma = 2, // 0.6m
  BM = 3, // 0.6m
  Triangle = 4, // 0.5m
  Box = 5, // 0.5m
  SmallFlat = 6, // 0.5m
  DoubleSpine = 7,
}
```

Booleans in `section.h` encoded as magic constants:

- `EULER = true`, `QUATERNION = false` → use a proper enum `Orientation.Euler | Orientation.Quaternion`.
- `TIME = false`, `DISTANCE = true` → use a proper enum `Argument.Time | Argument.Distance`.

The `.fvd` writer must still emit the legacy bool values.

### 4.2 `MNode` (core/mnode.h) **[T1]**

```typescript
// Per-node state at 1000 Hz. Keep flat and allocation-free in hot paths.
export interface MNode {
  // Pose
  pos: vec3; // heart-relative path position (gl-matrix)
  dir: vec3; // unit forward
  lat: vec3; // unit lateral (right)
  norm: vec3; // cross(dir, lat), recomputed after changes
  roll: number; // radians? — check fvd++: it's radians internally, degrees in UI

  // Kinematics
  vel: number; // m/s along heart path
  energy: number; // 0.5*v^2 + g*y(0.9*heart), see track.cpp:50

  // Forces (the functions' outputs, sampled per node)
  forceNormal: number; // g
  forceLateral: number; // g
  smoothNormal: number; // after smoothhandler
  smoothLateral: number;

  // Per-step deltas
  distFromLast: number;
  heartDistFromLast: number;
  angleFromLast: number;
  trackAngleFromLast: number;
  dirFromLast: number;
  pitchFromLast: number;
  yawFromLast: number;
  rollSpeed: number;
  smoothSpeed: number;

  // Running totals
  totalLength: number;
  totalHeartLength: number;
}
```

**Storage:** do **not** allocate one object per node. Use a struct-of-arrays over `Float32Array`s, one array per field. 60k nodes × 25 floats × 4 bytes = ~6 MB per track — acceptable, and transferable between worker and main thread with zero copy.

### 4.3 `SubFunc`, `Func`, `Section`, `Track`, `Project` **[T1]**

Port `core/subfunction.h`, `function.h`, `section.h`, `track.h`, `ui/projectwidget.cpp` (for project-level fields — texture path, track list, POV pos, etc.).

Each section subclass (`secstraight`, `seccurved`, `secforced`, `secgeometric`, `secbezier`, `secnlcsv`) becomes a discriminated union variant on `SecType`. No inheritance. The `updateSection` method becomes a free function `integrate<T extends Section>(section: T, fromNode: number): void` with a switch on type.

### 4.4 Physical constants **[T1]**

From the C++:

- `F_HZ = 1000.0` — integration rate. Keep exactly.
- `F_G = 9.80665` — check C++ for exact value; must match for NL2 compatibility.
- `F_PI = Math.PI` — use the language's.
- Heart offset during energy calc: `0.9 * heartLine` (see `track.cpp:50`). Not `1.0`. Don't "fix" it.

### 4.5 Units policy — canonical SI internally, dual-unit UI externally **[T1]**

**Internal storage, computation, file formats, and IPC payloads are SI only:** meters, seconds, meters/second, radians, g-force (dimensionless, multiples of `F_G`). No locale-dependent formatting crosses a module boundary. The physics core (`packages/core/`) does not know what a mile or a km/h is; the file format does not store unit preferences with the data.

**The UI is multi-unit.** FVD++'s `eMeasures` enum (`metricMPS`, `metricKPH`, `english`) is the baseline; we extend it. User preference (§14.4):

```typescript
type MeasurementSystem = 'metric-mps' | 'metric-kph' | 'imperial';

interface Units {
  system: MeasurementSystem;
  // derived:
  length: 'm' | 'ft';
  speed: 'm/s' | 'km/h' | 'mph';
  force: 'g'; // always g in all systems — it's dimensionless
  angle: 'deg'; // always degrees in UI (internal: radians)
  angularVel: '°/s';
  time: 's' | 'ms'; // auto-choose by magnitude
}
```

**Every displayed numeric value** passes through a `format(value, kind, units)` helper. Every numeric input passes through a `parse(text, kind, units)` helper that accepts multiple formats (e.g. `"10 m"`, `"10m"`, `"10"`, `"32ft"`, `"32.8 feet"`) and returns SI. Ambiguous input defaults to the current preference.

**Per-input unit override.** An input can display a different unit than the preference — useful for, say, showing a lateral G value in m/s² when debugging, or entering a specific section time in ms. Implemented via a small unit dropdown next to the input, defaulting to the user's preference.

**Dual-unit labels.** Where screen space allows, show both: `"24.5 m/s (88 km/h)"`. Mandatory in the stats overlay (§7.6). Optional, user-toggleable in other places.

**Section argument units.** `Forced` and `Geometric` sections have a `bArgument` flag: `TIME` or `DISTANCE`. The properties panel (§7.5) renders the argument input labeled accordingly (seconds vs. meters) and the timeline (§7.4) can plot the function's x-axis in either unit — user toggles per graph, persisted per-project. Switching between them is a display concern only; the underlying subfunction stores its argument in its native unit (seconds for TIME-arg, meters for DISTANCE-arg).

**Playhead.** Always stored as signed heart-distance in meters (§6.3). Display toggles between time and distance as noted.

## 5. Physics port — the critical path

**Read `core/secforced.cpp` lines 110–135 before writing a single line of TypeScript.** That's the whole integrator in about 25 lines. The rest of the file is bookkeeping.

The per-step update for a force-based section is:

```
forceVec = -Normal(t) * prev.norm  -  Lateral(t) * prev.lat  -  [0, 1, 0]   // gravity last
estVel = (prev.heartDistFromLast ~= 0) ? prev.vel : prev.heartDistFromLast * F_HZ

nForce = force along curr.norm    (project forceVec)
lForce = force along curr.lat     (project forceVec)

curr.dir = normalize( angleAxis(nForce / F_HZ / estVel, prev.lat) *
                      angleAxis(-lForce / prev.vel / F_HZ, prev.norm) *
                      prev.dir )
curr.lat = normalize( angleAxis(-lForce / prev.vel / F_HZ, prev.norm) * prev.lat )
curr.norm = cross(curr.dir, curr.lat)

curr.vel = sqrt( 2 * (curr.energy - F_G * curr.posHearty(0.9 * heart)) )
curr.pos += (curr.dir + prev.dir) * (curr.vel / (2*F_HZ))
          + (prev.posHeart(heart) - curr.posHeart(heart))   // heart-offset correction

curr.roll += rollFunc(t) / F_HZ    // or euler correction if orientation=EULER, see line 134-136
```

Port this exactly. Quaternion multiplication order matters — in `gl-matrix`, `quat.multiply(out, a, b)` gives `a*b`. The C++ applies `angleAxis(...lateral) * angleAxis(...normal) * prev.dir`; match the order.

### 5.1 Section integrators **[T1]**

One per variant. Each is a function that, given a `Section` and a starting node index, writes to the section's node array and returns the new length in nodes.

| Section   | File to port            | LOC | Complexity                                                          |
| --------- | ----------------------- | --- | ------------------------------------------------------------------- |
| Straight  | `core/secstraight.cpp`  | 222 | Trivial — constant direction, apply roll function                   |
| Curved    | `core/seccurved.cpp`    | 306 | Constant pitch+yaw rates, with lead-in/out blending                 |
| Forced    | `core/secforced.cpp`    | 463 | The template — time-domain and distance-domain variants             |
| Geometric | `core/secgeometric.cpp` | 526 | Same skeleton as Forced but pitch/yaw direct instead of from forces |
| Bezier    | `core/secbezier.cpp`    | 430 | Heaviest — reparameterizes a cubic Bezier to arc length             |
| NL CSV    | `core/secnlcsv.cpp`     | 276 | Reads pre-sampled nodes from imported NL2 track                     |

**Do each section in its own PR.** After each, the golden-file test suite (see §10) must pass for that section type.

### 5.2 Functions & SubFunctions (transition math) **[T1]**

`core/subfunction.cpp` `getValue(x)` is the function you'll call millions of times per recompute. Port it carefully. The polynomial forms (from `subfunction.cpp`):

- **linear:** `symArg*x + startValue`
- **cubic (default smoothstep):** `symArg * x² * (3 - 2x) + startValue`
- **quartic:** asymmetric and symmetric forms, check `arg1` — see lines 180–200
- **quintic:** 5th-order smooth, `arg1` controls shape
- **plateau:** flat middle with `arg1` width
- **sinusoidal:** half-cosine
- **tozero:** curve back to zero at a specified rate; uses `centerArg`/`tensionArg`
- **freeform:** cubic Bezier with two control points `pointList[0]`, `pointList[1]`; implementation in `updateBez()` uses Newton iteration to reparameterize. Port exactly.

`applyCenter(x)` and `applyTension(x)` are timewarp transforms applied **before** the polynomial. Port them before anything else — they affect every transition.

### 5.3 Smoothing

`core/smoothhandler.cpp` (208 LOC) — smooths the force curves across section boundaries to remove kinks that pure per-section design can't avoid. It's iterative. Port it last; it's not on the critical path for a minimal working build. **[T1]**

### 5.4 Cumulative time and distance arrays — the playhead integrator **[T1]**

The integrator produces a node stream at fixed 1000 Hz _of track integration_, not of wall-clock time. A node at index `i` corresponds to a specific point in the ride, but the wall-clock time to reach it depends on the speed profile — fast through a drop, slow up a lift hill. To scrub the playhead in real time (§6.3), and to let the user enter and display property values in either time or distance, we maintain **cumulative** arrays alongside the node stream, one pair per track:

```typescript
interface CumulativeArrays {
  cumulativeTime: Float64Array; // [i] = seconds from anchor to node i, in chronological order.
  // Always monotonically non-decreasing (time only moves forward).
  cumulativeDistance: Float64Array; // [i] = signed heart-distance from anchor to node i.
  // Monotonic on forward-only tracks. NON-monotonic when reversals exist.
  // See §6.6 for reversal semantics.
}
```

#### Computation

After each integration pass (whole-track or partial from section N), walk the affected node range:

```
cumulativeTime[0] = 0
cumulativeDistance[0] = 0
for i in 1..N:
    dt = 1 / F_HZ                                    // integration step is fixed
    cumulativeTime[i] = cumulativeTime[i-1] + dt
    ds_signed = sign(node[i-1].vel) * node[i].heartDistFromLast
    cumulativeDistance[i] = cumulativeDistance[i-1] + ds_signed
```

Note: `cumulativeTime[i] = i / F_HZ` in a simple forward integration, but when ReverseSections (§6.6) introduce direction changes mid-section, node indexing is still chronological so the formula holds — every node represents one 1ms wall-clock tick regardless of which way the train is going. This is critical: **node index is the canonical chronological dimension.**

#### Lookups

Three lookup directions needed:

- **Time → node:** `bsearch(cumulativeTime, targetSeconds)` → `O(log n)`. Used when user scrubs time scrubber to `t = 47.3s`, or when playback advances by wall-clock `dt`.
- **Node → time / distance:** direct array access `O(1)`.
- **Distance → node:** when user scrubs the distance scrubber. For monotonic `cumulativeDistance` (the common case, forward-only tracks), `bsearch` as above. For non-monotonic (tracks with reversals), the signed distance `d` may correspond to multiple nodes visited at different times — resolve by **continuity preference**: pick the node whose time is closest to the current playhead time. This gives intuitive scrub behavior: dragging the handle forward through a shuttle rollback moves the train back through space as the user's finger moves forward.

#### Memory and recompute

Each cumulative array is 8 bytes/node × 60k nodes = 480 KB per track. Cheap. Both arrays are recomputed fully whenever the section range changes; partial updates from node N onward update entries `N..end` only.

The worker owns both arrays and transfers them to the main thread along with the node SoA via transferable `ArrayBuffer`s.

### 5.5 Unit conversions — the cost of derived values **[T1]**

Per §4.5, internal storage is SI. UI inputs and displays pass through format/parse helpers. But some values have a **native** unit that's not the one the user wants to edit in, and converting requires integration results:

- **`Forced` / `Geometric` section `iTime`**: native = milliseconds (`F_HZ`-ticks). User may want "how long in seconds at 1× playback" (trivial: `iTime / F_HZ`) or "how long in meters of heart distance" (non-trivial: `cumulativeDistance[nodeAtSectionEnd] - cumulativeDistance[nodeAtSectionStart]`).
- **Section argument type (`TIME` vs `DISTANCE`)**: FVD++ stores subfunction arguments in _either_ time or distance per-section, not both. Switching argument type is destructive: the physics changes (same keyframes at new positions produce a different track).

Per user decision (§0 tier): **editing a derived-unit value always switches the argument type** to match what the user is editing in. The flow:

1. User edits "section length" in meters on a section whose `bArgument = TIME`.
2. Tool computes the new target: "we want this section to be `newLengthMeters` meters long."
3. Tool binary-searches: "what `iTime` in ms, if we recompute the section, produces that heart-distance?" This is a numerical root-find because changing duration also changes the forces' argument range, which changes the resulting geometry.
4. To avoid the root-find altogether in the common case, tool prompts: "Switch this section to use distance as its argument? This will re-map keyframes onto the distance axis, preserving the current shape as closely as possible."
5. On accept: argument type switches to `DISTANCE`, subfunction arguments are rescaled from `[0, oldTimeSeconds]` to `[0, newLengthMeters]`, the user gets exactly what they asked for without a root-find.

The alternative (root-find without switching argument type) is supported via a separate "Fit to duration..." dialog for power users who specifically want the time-argument physics to result in a specific heart distance. This is a T2 feature.

#### Playhead conversion

Playhead is stored as signed heart-distance (§6.3). Display as time uses the `cumulativeDistance → node → cumulativeTime` lookup chain. This is O(log n) per display update — cached between frames when playhead isn't moving.

## 6. Rendering

The 3D scene has four layers, built and updated independently:

1. **Track mesh** — rails, spine, crossties. Auto-generated from the node stream and track style (§6.1).
2. **Supports** — structural columns/footers. See §6.5 for the policy decision.
3. **Train model** — a visible marker at the playhead in non-POV camera modes. See §6.5.
4. **Environment** — ground plane, grid, sky, optional imported NL tracks as visual guides. Cheap static meshes, built once.

Each layer is a separate `THREE.Group` in the scene graph so visibility toggles, LOD swaps, and rebuilds target only the affected layer.

### 6.1 Track mesh generation **[T1]**

Given the 1000 Hz node stream, build a tube mesh per `TrackStyle`. `core/renderer/trackmesh.cpp` (~3,700 LOC) is the reference — but most of it is OpenGL plumbing Three.js replaces. The actual mesh-generation logic is much smaller.

#### Per-style constants (port verbatim from `renderer/trackmesh.cpp:1200–1255`)

| Style         | `numRails` | `railSpacing` (m) | `crosstieSpacing` (m) | `spineHeight` (m)  | `spineSize` (m)       |
| ------------- | ---------- | ----------------- | --------------------- | ------------------ | --------------------- |
| `Generic`     | 3          | 0.50              | 1.50                  | 0.30 × sign(heart) | 0.22                  |
| `GenericFlat` | 2          | 0.70              | 1.40                  | —                  | —                     |
| `Vekoma`      | 3          | 0.60              | 1.50                  | 0.85 × sign(heart) | 0.22                  |
| `BM`          | 3          | 0.60              | 1.45                  | 0.50 × sign(heart) | 0.366 (0.26 × 1.4101) |
| `Triangle`    | 3          | 0.50              | 1.00                  | 0.75 × sign(heart) | `railWidth` (0.065)   |
| `Box`         | 4          | 0.50              | 1.00                  | 1.00 × sign(heart) | `railWidth`           |
| `SmallFlat`   | 2          | 0.50              | 0.80                  | —                  | —                     |
| `DoubleSpine` | 4          | 0.50              | 0.30                  | 0.30 × sign(heart) | 0.18                  |

`railWidth = 0.065 m` for all styles.

These are **visual** parameters only — they do not affect physics (physics is on the heart line, which is a user setting `track.heart`).

#### Cross-section geometry

Each style's cross-section is a set of 2D points `(lat, norm)` relative to the heart position, extruded along `dir`:

- **Rails**: per rail, a circular pipe (12 edges) of radius `railWidth`, at positions determined by `numRails` and `railSpacing`. Standard 3-rail: two outside rails at ±`railSpacing/2` laterally, one spine rail vertically offset.
- **Spine**: for styles that have one (`Generic`, `Vekoma`, `BM`, `DoubleSpine`), a pipe or box beam below/above the heart line by `spineHeight`, cross-section `spineSize`.
- **Crossties**: rectangular bars perpendicular to `dir`, spaced at `crosstieSpacing` in heart distance.

Port the specific cross-section functions from `trackmesh.cpp:1487–2225` (the big `switch(style)` blocks in the sweep loop). For the TS port, define each style's cross-section as a function `(heartOffset: number, railWidth: number) => CrossSection` returning ring vertices per pipe.

#### Sweep

For each pipe in the cross-section, sweep along sampled nodes:

1. At each sample node, take `(pos, dir, lat, norm)` from the integrated node.
2. Emit a ring of `edges` vertices (default 12) by rotating the pipe's local `(lat, norm)` offset into world space.
3. Connect consecutive rings with triangle strips.

Three.js: build one `BufferGeometry` per pipe using `Float32Array` positions/normals/UVs. Reuse index buffers across identical-topology pipes.

#### Adaptive tessellation (LOD)

Rendering at 1000 Hz is overkill. Adaptive sampling based on curvature, matching `trackmesh.cpp:1294–1313`:

```
minNodeDist = 12 / meshQuality         // meters — min distance between mesh rings
maxNodeDist = 0.3 / meshQuality        // meters — max distance (i.e. denser)
angleNodeDist = 6 / meshQuality        // degrees — force new ring after this much total bend
```

Walk the node stream; accumulate `fFlexion * fDistFromLast` (total angle). Emit a mesh ring when either the max-distance threshold is crossed or enough angle has accumulated. This gives dense rings through inversions and sparse ones on straight sections.

Mesh quality is a user setting (§14.4 preferences): `Low (1)`, `Medium (2)`, `High (4)`, `Ultra (6)`.

#### Shadow geometry

Separate mesh for shadow casting (lower poly, no spine/crossties). Three.js `DirectionalLight` + shadow map. FVD++ has its own shadow-volume shaders; we don't port those — use Three.js built-in PCF shadow maps. Quality toggle: off / medium / high.

#### Partial rebuild

When a section's nodes change, rebuild only the mesh rings covering that section onward. Keep ring-count per section; slice the index buffer accordingly. For simplicity, v1 can rebuild the whole mesh and optimize later if profiling shows it's needed — at Medium quality a 60k-node track produces ~2k rings, total rebuild < 30 ms.

#### POV building border (FVD++ parity)

FVD++ shows a 5m-tall building clearance box around the track in POV mode (`B` key toggle). It's drawn as a transparent mesh swept along the track at ±5m in `norm` and ±2m in `lat`. Useful for checking terrain clearance. Implement as a togglable THREE.LineSegments mesh.

### 6.2 Color-coded visualizations **[T1]**

FVD++ can color the track by force magnitude, roll speed, or flexion. Implementation:

- Store per-ring scalars (max force magnitude in that ring's arc) as a vertex attribute.
- Fragment shader samples a gradient texture (or uses a LUT uniform) indexed by the attribute.
- Changing mode = swap the attribute buffer, no geometry rebuild.

FVD++ exposes user-customizable gradient endpoints for each metric (`rollColor[4]`, `normColor[4]`, `latColor[4]` — a 4-stop gradient per metric). Port as preferences.

Gradient modes:

- **Normal force**: green for 1G (neutral), red for > threshold positive, blue for < threshold negative (airtime). Thresholds user-configurable.
- **Lateral force**: green for 0G, magenta for high lateral both ways.
- **Roll speed**: green to orange.
- **Flexion**: green to red (kink detection).
- **None**: solid color.

### 6.3 Playback & POV **[T1]**

Playback is a first-class feature, not a mode. A single **playhead** — a position expressed as heart-distance from the anchor (not a node index, because recompute can change the node count) — is shared across the whole application. The 3D viewport, the POV view, the timeline, the graphs, and the stats overlay all render at the current playhead and all update together when it moves.

This means the user can:

- scrub the timeline and watch the train fly along the track in the editor viewport, simultaneously watching forces sweep across the graphs
- hit **Space** in any view to play the ride at real-time speed
- switch between editor view and POV view mid-playback without losing position

#### Playback state

```typescript
interface PlaybackState {
  playheadDistance: number; // SIGNED heart-distance from anchor. Positive = forward from anchor,
  // negative = the train has traversed backwards past the anchor.
  // For shuttle/swing sections, this can decrease over time.
  activeTrackId: TrackId; // which track the playhead is on (projects can have multiple)
  playing: boolean;
  playDirection: 1 | -1; // scrub direction: forward or reverse. Independent of the
  // train's own direction of travel — lets the user "rewind"
  // for review even on a forward-only track.
  speedMultiplier: number; // 0.25 · 0.5 · 1 · 2 · 4 · 8
  loopMode: 'off' | 'track' | 'section';
  cameraMode: CameraMode; // see below
  povOffset: vec3; // camera offset from the heart point (lat, normal, dir)
}
```

Playhead is advanced by `dt × speedMultiplier × playDirection × signedVelocity(playhead)`, where `signedVelocity` is the physics velocity at that point on the track (which itself can be negative — see §6.6). At 1× with the train at 20 m/s forward, the playhead moves 20 m/s of heart-distance. When the train goes through a shuttle section and reverses, the playhead moves backward while `playDirection = 1` — this is the correct behavior because it reveals how the ride actually feels.

`playDirection = -1` ("rewind") is separate and user-controlled via `J` (§13). It lets you review a moment in reverse regardless of which way the train itself is moving. This is the video-editor model.

At end-of-track: pause, unless `loopMode` is `track` (restart at anchor) or `section` (restart at current section's start).

#### Dual-unit display (time ↔ distance)

The playback bar's time readout is a **toggle**, not a fixed format. Click it to cycle:

- `⏱ 00:24.3 / 01:47.8` — time from anchor (minutes:seconds.tenths).
- `📏 147.2 m / 634.1 m` — heart-distance from anchor.
- `📏 482.9 ft / 2080.4 ft` — imperial equivalent (if `measurement === 'english'` in preferences).

The underlying state (`playheadDistance`) is always in SI meters; display is a pure formatting concern. Scrubbing in either representation works — drag the time label and it behaves as a numeric scrubber in the currently-displayed unit.

#### Camera modes

Both the editor 3D view and the POV view are the same Three.js scene with a different camera. Switching is instantaneous; no scene tear-down.

- **Orbit** (editor default): free camera around the track. Playhead shown as a moving train model on the track.
- **Follow**: third-person chase camera locked behind the train at a fixed offset in `(lat, norm, dir)` frame. Train visible ahead.
- **POV**: first-person camera at the train's heart position + `povOffset` (so designers can sit the camera where the rider's eyes are, not on the heart line). Orientation taken from `(dir, norm, lat)` at the current node. The train model is hidden. This is what "riding the coaster" means.
- **Locked**: camera at a fixed world position, watching the train pass. Useful for screenshots and reviewing a specific element.

Arrow keys in POV mode adjust `povOffset` live (FVD++ v0.7 behavior): Up/Down = shift along `dir`, Left/Right = shift along `lat`, PageUp/PageDown = shift along `norm`. `R` resets to default POV offset.

#### Train model — tiered plan

KexEdit has a rich train model system (multi-car configurations, custom GLTF/OBJ meshes, front/middle/back car variation, wheel-assembly meshes, up to 20 cars per train). FVD++ has no visible train at all. Our plan spans three tiers.

**[T1] Single-point chassis visual.** A stylized low-poly block at the playhead, scale-configurable. No car physics. Forces displayed are heart-line forces, with a UI badge "single-point" acknowledging that they do not reflect front/back-of-train variation.

- Dimensions: ~2.5 m × 0.5 m × 0.4 m (length × width × height). Sits on the rails with correct orientation `(dir, norm, lat)`.
- Color: neutral gray by default, user-settable per track (multiple tracks → visually distinct).
- Visible in Orbit, Follow, Locked modes. Hidden in POV mode.
- Orientation: integrated node at the playhead. No train physics of its own.

**[T2] Multi-car visual with spacing.** Port KexEdit's custom train styles (`docs/user-guide/custom-train-styles.md`): JSON configuration files describing a train (name, front/middle/back car mesh paths, wheel assembly mesh, 1–20 cars). Cars positioned by heart-distance offsets along the node stream. Each car's orientation comes from its position's integrated node.

- File format: compatible with KexEdit's `trains/*.json` + `.obj/.gltf/.glb` files. User can drop KexEdit train packages into WebFVD's trains folder (IndexedDB in the browser; real folder in Electron if we ever ship that).
- GLTF materials preserved. OBJ gets default PBR material.
- Force display gains a "car position" selector: compute forces at front car, middle, back, specific car index. Reuses the Pivot system (§7.4) since a pivot is exactly this.
- **Still visual.** Cars move rigidly along the track; no inter-car dynamics.

**[T3] Full rigid-body multi-car physics.** Each car is a rigid body with mass and moment of inertia. Cars are coupled by constraints (typically pin joints — revolute along `lat` — at known positions on adjacent cars). The train rolls along the track under gravity, friction, and the track constraint forces.

- This is a genuine physics engine, not a visual upgrade. ~2000 LOC in the core at minimum.
- Numerical: fixed-step semi-implicit Euler at 1000 Hz matching the track integration rate. Constraints solved by Gauss-Seidel projection (simple, converges fast for tree-topology chains). Compute on demand during simulation/playback, not baked.
- The train experiences forces the track doesn't dictate: inter-car swing into a curve, weight transfer on hills, etc. **These forces may differ materially from FVD++-style heart-line forces.** The tool must distinguish "design forces" (heart-line, what the designer specified) from "simulated forces" (what riders would actually feel). Display both, let the user compare.
- Unlocks: realistic coaster-front-has-more-airtime visualization, accurate evaluation of whether a hill design works across the whole train length, proper shuttle-coaster coupling dynamics.
- The simulated forces are NOT used for export (NoLimits has its own physics). They're an analysis aid.

Multi-car forces at T2/T3 require sampling the node stream at `N` pivot offsets simultaneously per playback frame. With cached cumulative arrays (§5.4), each sample is O(log n). For N=20 cars at 60 fps, that's 1200 bsearches/sec — trivially cheap.

#### Interaction with editing

Edits can happen during playback. Recompute runs in the worker; when new node data arrives, the playhead stays at the same _signed heart-distance_ (since it's distance-based, not index-based), so the train doesn't jump. If the new track is shorter than the previous playhead position, clamp to track end and pause.

#### UI controls

A compact playback bar, always visible at the bottom of the 3D viewport (both editor and POV views):

```
[◀◀ section]  [▶ play / ❚❚ pause]  [section ▶▶]   0.5× 1× 2× 4×   ⟲ loop: off | track | sec   [camera: ▼ Orbit ]   ⏱ 00:24.3 / 01:47.8
```

- Section-skip buttons jump to next/previous section boundary.
- Speed is a clickable pill, not a dropdown.
- Loop toggle cycles through the three modes on click.
- Camera dropdown reflects `cameraMode`, also changeable via keyboard (see §13).
- Time display: current time / total ride time, both at 1× speed. Click to toggle time ↔ distance units as described above.
- Below the bar: a thin scrubber representing the whole track, with section boundaries as tick marks, the playhead as a draggable handle. Grab and scrub to jump anywhere. For backwards-traveling sections (§6.6), the scrubber shows the _chronological_ order, not the spatial order — so a shuttle out-and-back fills the full scrubber even though it reuses the same track.

The timeline (§7.4) has its own playhead indicator on the time axis, synchronized to the same playback state. Dragging either the timeline playhead or the bottom scrubber moves both — they are one value.

### 6.4 3D navigation — three input contexts **[T1]**

The 3D viewport must feel correct in three distinct input contexts: **3-button mouse** (desktop users), **Mac trackpad** (MacBook users, no middle button), and **2-button laptop trackpad** (Windows/Linux laptop users). Each has conventions users expect. One scheme fits all is a lie; we ship three defaults and let users switch.

The system defaults to the right scheme based on the detected platform and input device:

- `navigator.platform` starts with `"Mac"` → default to Mac trackpad scheme.
- `navigator.maxTouchPoints > 0` and no obvious mouse signals → default to trackpad scheme.
- Otherwise → desktop 3-button scheme.

All schemes are user-overridable via preferences. All schemes support all operations (pan, orbit, zoom, frame, select) — no operation is reachable only on one input type.

#### Scheme A: Desktop 3-button mouse (Fusion 360 style)

Default on Windows/Linux desktop. Based on Fusion 360's default preset.

| Input                                   | Action                                       |
| --------------------------------------- | -------------------------------------------- |
| Middle mouse button drag                | **Pan**                                      |
| Shift + middle mouse drag               | **Orbit** around the current pivot           |
| Shift + middle mouse _click_ on a point | Set orbit pivot to clicked point, then orbit |
| Mouse wheel                             | **Zoom** toward cursor                       |
| Left-click a track section              | Select (no camera interaction)               |
| Right-click on empty space              | Context menu                                 |
| Right-click + hold                      | Fly mode (see below)                         |
| `F`                                     | Frame selected section                       |
| `A` (or Home)                           | Frame all                                    |
| `Numpad 1/3/7 + Ctrl`                   | Front / Side / Top view                      |
| Click ViewCube face                     | Snap to that view                            |

#### Scheme B: Mac trackpad (gesture-first)

Default on macOS, and what MacBook users will reach for on muscle memory. No middle mouse button exists. No right-click-hold convention on trackpads (it conflicts with two-finger-tap = right-click). Apple's system-wide convention is that gestures on the trackpad mean pan/zoom/rotate without modal clicks.

| Input                                         | Action                                                               |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Two-finger swipe                              | **Pan** (matches macOS system-wide behavior)                         |
| Shift + two-finger swipe                      | **Orbit** around the current pivot                                   |
| Pinch (two fingers in/out)                    | **Zoom** toward cursor                                               |
| Two-finger tap on a point, then Shift + swipe | Set orbit pivot, then orbit                                          |
| One-finger tap (click) on a track section     | Select                                                               |
| Two-finger tap on empty space                 | Context menu                                                         |
| `Option` (Alt) + two-finger swipe             | **Orbit** (alternative, for users coming from Fusion's Alias preset) |
| `F`                                           | Frame selected section                                               |
| `A` (or `Fn+Left` / Home)                     | Frame all                                                            |
| Click ViewCube face                           | Snap to that view                                                    |

No "right-click-hold to fly" on Mac trackpad — it doesn't work, and users don't expect it. Fly mode on Mac is opt-in via a keyboard shortcut (see below).

Notes on the implementation:

- Browsers expose trackpad gestures as `WheelEvent` with `ctrlKey` auto-set on pinch (macOS convention; also detected by `event.deltaY` with small fractional values typical of trackpad). Handle these as zoom.
- Two-finger swipe comes through as `wheel` events with `deltaX`/`deltaY`; treat as pan.
- `WheelEvent` with Shift held → repurpose as orbit.
- Test on real hardware early. Browser pointer events on Mac trackpads are subtle; a day of tuning is likely needed to get feel right.

#### Scheme C: Windows/Linux laptop trackpad

Many Windows/Linux laptop trackpads support multi-finger gestures, but the gestures are less consistent across manufacturers. Offer the same gesture bindings as Scheme B with Ctrl instead of ⌘ where applicable, but provide a **keyboard-first fallback** for trackpads that don't pass through multi-finger events reliably:

| Input                                   | Action             |
| --------------------------------------- | ------------------ |
| Two-finger swipe (if supported)         | Pan                |
| Shift + two-finger swipe (if supported) | Orbit              |
| `G` then drag (à la Blender)            | Pan (fallback)     |
| `R` then drag                           | Orbit (fallback)   |
| Mouse wheel / two-finger scroll         | Zoom toward cursor |

#### Fly mode (all schemes)

Accessible via **`Tab`** from any scheme (not right-click, because that collides on Mac). While Fly mode is active:

| Input                 | Action              |
| --------------------- | ------------------- |
| Mouse / trackpad move | Look around         |
| `W` / `S`             | Forward / back      |
| `A` / `D`             | Strafe left / right |
| `Q` / `E`             | Move down / up      |
| `Shift`               | 3× speed            |
| Mouse wheel / pinch   | Adjust fly speed    |
| `Tab` or `Esc`        | Exit Fly mode       |

Fly mode is a _free_ camera — disconnected from the track. Distinct from POV mode (§6.3), which locks the camera to the playhead on the track.

#### Alternative presets (all platforms)

For users coming from other tools, selectable in preferences:

- **Blender** (middle-drag orbit, Shift+middle pan, scroll zoom).
- **SolidWorks** (scroll-wheel-drag orbit).
- **Unity / KexEdit** (Alt+drag orbit; matches what KexEdit does).
- **Inventor** (F-keys as modifiers — designed for trackpad-only laptops).
- **Onshape** (right-click-drag orbit, Ctrl+right-click-drag pan).

Each preset replaces the default bindings for that platform; the preset choice is stored per-user in `preferences.navigation.preset`. The default for first-time users is the platform-detected scheme above.

#### ViewCube

A small 3D orientation cube in the top-right of the 3D viewport. Shows current orientation via face labels (Front, Top, Right, etc). Clicking a face snaps the camera to that axis. Dragging the cube rotates the view. This is the **always-available** navigation aid that works identically on every input device — mouse, trackpad, whatever — because it's just click-on-face.

Three.js doesn't have one out of the box; implement as a secondary `WebGLRenderer` drawing into a small canvas overlay with hit-testing (~300 LOC).

#### Selection in the 3D view

Click a track section to select it. Selection is shared with the Sections list, Table view, Properties panel, and Timeline. Visually: selected section highlighted with an emissive outline, non-selected track darkened slightly. Selection click does not initiate navigation (no click-drag ambiguity).

### 6.5 Supports and structure **[T1 passive → T2 manual → T3 auto]**

**Decision point.** FVD++ has no automatic support generator. Its `supList` (per-bezier-section) only contains supports imported from NL1 tracks — it's passive, not generative. We have three options, listed with their cost:

| Option                                    | Effort                                                                                                                                               | User value                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **A: Port as-is (passive supports only)** | Low — just render the `supList` points as vertical columns when present                                                                              | Low — matches FVD++ exactly but the feature is near-useless for new designs |
| **B: Manual support placement**           | Medium — add a "supports" panel with click-to-add, drag-to-position columns                                                                          | Medium — lets designers sketch structure but tedious for full coasters      |
| **C: Automatic support generator**        | High — algorithm needs to cast vertical rays from track nodes to ground, place columns at spacing based on track style, handle overhangs and terrain | High — makes the 3D preview actually look like a coaster                    |

**Recommendation for v1: Option A.** Document it as "imported supports only" and leave the generator as a future enhancement. Rationale: the core value of a FVD tool is the track, not the structure. Designers who need structural preview export to NoLimits anyway. Generator algorithms that look good are non-trivial (B&M vs wooden vs launched-coaster structure is wildly different) — doing it half-assed is worse than not doing it.

**Future v2 path:** revisit after v1 ships if user feedback demands it. If pursuing, study KexEdit and NoLimits' own support placement as references.

### 6.6 Backwards motion and shuttle/pendulum physics **[T2]**

**New feature (not in FVD++).** FVD++'s physics assumes non-negative velocity: it recovers velocity via `fVel = sqrt(2 × energy)` (always positive), and its integrators bail out when velocity drops below 0.01–0.1 m/s. This rules out shuttle coasters, swing rides, pendulum sections, launched-and-returned dragster rollbacks, and any section where the train changes direction mid-ride. These are real coaster elements; we add proper support.

#### Physics changes

1. **Signed velocity.** `MNode.vel` becomes signed (type unchanged, semantics extended). Recovery from energy:

   ```
   v_magnitude = sqrt(2 × max(0, energy - g × y_heart - friction_loss))
   v_signed    = direction_of_travel × v_magnitude
   ```

   where `direction_of_travel ∈ {+1, -1}` is tracked as a per-node boolean field `traveling_forward`.

2. **Direction reversals.** A reversal happens when `v_magnitude` passes through zero. Detect per step:
   - If `v_signed(prev) > 0` and `v_magnitude(curr)` hits the floor without energy being added, the train has stalled — flip `traveling_forward`, add a small epsilon to avoid sticking, continue integrating with the forward-pointing tangent _reversed_ in position updates but not in roll/pitch (the train is rolling backward down the hill, not flipping upside down).
   - Position update uses `curr.pos += v_signed × dir × dt` (so negative velocity moves the train backward along the same tangent).
   - The quaternion integration for `dir`/`lat` continues to use the signed `v` — curvature bends the train less per unit distance at lower speed regardless of sign, which is correct.

3. **Energy handling.** Friction opposes motion (so sign flips with direction): `dE/dt = -friction × |v|³ × sign(v) × sign(v) = -friction × |v|³`. Unchanged in magnitude; still always dissipative.

#### Section-type semantics

The existing section types (`Straight`, `Curved`, `Forced`, `Geometric`, `Bezier`) integrate forward from the anchor. None of them can _cause_ a reversal on their own; they can only respond to one if the train arrives going backward.

To _cause_ a reversal, introduce two new section types:

- **`ReverseSection`** (new): an instantaneous flip at a specific point. The train's velocity is reflected (`v → -v`), position is continuous, orientation is continuous. Useful for: shuttle bumpers, launch-end rollback points, pendulum reversal points. Has no length of its own; it's a zero-length "event" section.
- **`ShuttleSection`** (new): a convenience wrapper — a `Forced` or `Geometric` section followed by a `ReverseSection` followed by the same sub-section traversed in reverse. For the common "out-and-back shuttle" use case where the train leaves the station, reverses at the end of a track arm, and returns through the same geometry experiencing mirrored forces.

Alternatively (simpler but less flexible): keep only `ReverseSection` and let designers manually compose out-and-back tracks from forward sections + reversal events. This is probably the right v1 trade-off — `ShuttleSection` can come later if usage patterns justify it.

#### Playhead and timeline implications

- `playheadDistance` as defined is the **chronological** distance from anchor along the train's actual path, not the cumulative positive heart-distance. So for an out-and-back shuttle with a 100 m arm, playhead at the reversal point = 100, at the halfway-back point = 150, at full return = 200.
- The 3D viewport train model moves along the track correctly because position is read from the integrated nodes (which encode position over time, so a shuttle's node stream visits the same spatial heart-distance twice).
- The timeline x-axis is chronological. Scrubbing to time `t=15s` selects the node with that cumulative time, regardless of spatial position.
- The force/speed graphs (§6.2, §7.4 overlay curves) are plotted against chronological time too. They show the full out-and-back experience as one continuous curve.
- The section-skip buttons (`,` / `.`) skip to section boundaries chronologically — so in a shuttle, forward-through-A → ReverseSection → backward-through-A counts as three skips, not two.

#### NoLimits compatibility

NoLimits 2 supports shuttle coasters natively (via its track modes). The NL2 exporter (§8.4) must handle reverse sections: emit the track geometry once, then tag the appropriate export segments with NL2's shuttle-behavior flag. Exact mechanism depends on NL2's current format; tests required. NL1 does not support shuttles — the NL1 exporter should **refuse** to export a track containing reversal sections with a clear error message, rather than producing silently-wrong output.

#### File format compatibility

The legacy `.fvd` format does not encode `ReverseSection` or signed velocity. A WebFVD project using these features **cannot** be round-tripped to `.fvd` without data loss. Save-as-`.fvd` on a project with reversals must show a warning dialog ("The following sections will be dropped because they are not supported in the legacy format: …") with the option to cancel or proceed with loss. The native `.webfvd.json` format has no such limitation.

### 6.7 Track topology — linear chain vs. DAG **[T1 linear → T2 DAG]**

FVD++ models a track as a strictly linear sequence of sections. KexEdit uses a full directed acyclic graph (DAG) with explicit anchor/path nodes, bridges, copy-path sections, and reverse-path nodes. These are genuinely different data models with different strengths.

**[T1]: Linear chain.** A track is an ordered list of sections. Each section has one predecessor (the previous in the list, or the anchor for the first), one successor. This is FVD++'s model and covers all traditional coaster designs.

**[T2]: Extended linear chain with splice operations.** Add support for shuttle rollbacks (§6.6) and KexEdit-style copy-path reuse without going full DAG. Semantically, `CopyPathSection` takes a reference to another section in the same track and reuses its node stream (optionally reversed) starting from the current anchor. Internally the track is still an ordered list; `CopyPathSection` is just a section type that computes its nodes by copy-with-transformation from another section's nodes. Works for 90% of what KexEdit's Copy Path supports with simpler data model.

**[T2]: Multi-track projects with bridges.** Multiple tracks per project (already in FVD++). Add `BridgeSection` that takes two anchor nodes (end of one track, start of another) and generates a smooth Catmull-Rom connector. Enables closed circuits: start the track at anchor A, build it out, bridge the last section's output to A, physics closes the loop. Bridge computes its own nodes based on curve interpolation, not force integration.

**[T3]: Full DAG with switch tracks.** Some sections have multiple outputs; the train's path through the DAG is determined by runtime switch-track state. This is the hardest topology upgrade because:

- The "next section" is no longer a property of the list; it's a runtime decision.
- Multiple trains on a DAG can take different paths.
- Integration is per-path, not per-track. The same section might be traversed twice by different paths with different entry conditions.
- Graph validation: no cycles other than legitimate ride cycles (shuttle out-and-back), all paths eventually terminate or loop.

**Recommended v1 (T1 only):** ship the linear chain, which covers everything FVD++ does and leaves clean architectural room for T2/T3 additions. Explicitly document that `CopyPathSection` and `BridgeSection` are T2, switch tracks T3. **Do not** implement a UI node graph at T1 — the linear list view + table view (§7) cover T1 needs perfectly.

**UI implication for T2:** a simplified node graph appears alongside the linear list as an _alternative view_ (not a replacement). Users can toggle which view is active. Those who grok node graphs get the flexibility; those who don't can continue with the list + table for anything that fits the linear model.

### 6.8 Modern coaster features beyond FVD++/KexEdit **[T3]**

FVD is a 2010-era abstraction. Real coasters built since then have features that don't fit cleanly into "a section is defined by a normal/lateral force curve over time or distance." Voltron at Europa-Park is a good reference case — it has seven inversions including a heartline roll, a beyond-vertical drop, three LSM launches with different target speeds, and a reverse section. These tier-3 features extend the section-type vocabulary and, crucially, **cannot be exported to NL1 or NL2** because those sims don't support them. Projects using T3 features must be flagged as "WebFVD-native" and export to NL-format files is refused with a clear error.

#### 6.8.1 Multi-launch sections (`LaunchSection`)

A launch section applies a specified acceleration profile over a specified track length. Train enters at velocity v₀, exits at a target v₁ > v₀. Physics: override the energy-based velocity with a prescribed v(s) curve; integrate the rest of the node stream accordingly.

- **Launch type:** LSM (smooth ramped force), LIM (similar), tire (stepped by roller banks), hydraulic (very high initial g). UI surfaces this as a preset dropdown that sets the default acceleration curve; the curve itself is editable in the timeline.
- **Target velocity:** user-specified. Actual curve interpolates from `v_entry` to `v_target` over the section length.
- **Direction:** launches can be forward or backward (many modern coasters launch, brake, reverse-launch harder, like Iron Gwazi or various Stengel-designed launches). Backward launches integrate with negative velocity per §6.6.
- **Multi-launch:** just multiple `LaunchSection`s in the track. No special multi-launch section type needed; the "multi" emerges from composition.

#### 6.8.2 Magnetic brakes with force curves (`BrakeSection`)

A brake section applies a _deceleration_ profile defined by a force curve (typically decreasing-magnitude as velocity drops, matching eddy-current brake physics). Unlike friction (`track.fFriction` and `track.fResistance`), which is global and always present, brake sections are localized and can have any shape.

- **Braking profile:** user-editable force curve, defaulting to a realistic magnetic-brake shape `F_brake = k * v²` or `F_brake = k * v` depending on brake type.
- **Target exit velocity:** user-specified. If the brake force is insufficient to achieve target over the section length, warn during integration.
- **Behavior at zero velocity:** brake section holds the train at `v=0` until some downstream launch or gravity re-accelerates it. This is how station brakes and MCBR (mid-course block brakes) actually work.

#### 6.8.3 Switch tracks (`SwitchSection`) — [T3]

A section with two (or more) output paths. Switch state is a project-level parameter; the active output determines the train's path. Requires the DAG topology from §6.7.

- **Setup:** `SwitchSection.outputs: SectionId[]` — list of possible next sections.
- **Runtime:** the integrator, when reaching a switch, checks `project.switchStates[switchId]` and continues integration down the chosen path.
- **Design time:** user can preview each path by switching the state, the node stream recomputes accordingly.
- **NoLimits:** NL2 has a switch track concept; investigate whether its format can round-trip our switch sections. If not, export refuses.

Typical use: a ride with a station, a mid-course switch to either "main lap" or "spike and return," enables the interesting dispatching patterns seen on Maverick, Taron, Voltron.

#### 6.8.4 Beyond-vertical drops and overhang geometry **[T3]**

The current mesh sweep (§6.1) builds the track cross-section perpendicular to `dir`. For beyond-vertical drops (pitch > 90°), the existing heart-based geometry still works mathematically, but the track-style constants (spine below/above heart line) need revision: "below" becomes ambiguous when "down" inverts.

Required changes:

- Spine-position computation switches to "always on the outside of the curve" for beyond-vertical sections, based on `sign(lat dotProduct worldUp)` or similar.
- Overhang visualization: render a visible beam structure above beyond-vertical track, showing track is supported from above (the real engineering). This is mostly cosmetic but distinctive.
- Shadow map needs to not self-shadow the track into black (common rendering issue on beyond-vertical geometry).

#### 6.8.5 Dark-ride sync points (`SyncPoint`) **[T3]**

For rides with theatrical elements (Harry Potter, Voltron's pre-show), the train must arrive at specific locations at specific times to sync with effects. A `SyncPoint` is a zero-length section that asserts "the train must be here at time t relative to dispatch." The optimizer (§6.9, KexEdit port) can adjust upstream section durations to satisfy sync constraints.

- **Project-level sync enforcement:** if sync points exist, the optimizer runs after every recompute to check constraints. Violated constraints highlighted in red in the timeline.
- **Export:** no NL-format support. Projects with sync points cannot export.

### 6.9 Optimizer — gradient descent to target values **[T2]**

Port KexEdit's optimizer (`docs/user-guide/optimizer.md`). Given a target value (roll, pitch, or yaw at a specific playhead position), iteratively adjust a specified keyframe value until the target is hit.

- **Use case:** "I want this turn to exit at exactly 0° roll." User places the playhead at exit, right-clicks a mid-turn roll keyframe, selects Optimize → Roll, targets 0°. Optimizer adjusts the keyframe until the track roll at playhead = 0°.
- **Algorithm:** simple gradient descent. Compute the target value at current keyframe, perturb ±epsilon, compute the derivative numerically, step toward target. Convergence in ~5-20 iterations for well-behaved cases.
- **Scope:** single keyframe adjustment, single target. Multi-parameter optimization is out of scope.
- **UI:** right-click keyframe → Optimize submenu (Roll / Pitch / Yaw / Velocity / etc). Dialog asks for target value (default 0). Start button runs optimization with visual progress.
- **Extended targets (T3):** optimize for a target force value, target speed at a position, or sync-point timing.

### 6.10 Engineering analysis features

Features that go beyond FVD++/KexEdit to make WebFVD useful for serious designers, drawing on what professional manufacturers (Mack, Vekoma, Stengel Engineering) do but scoped to what's realistic for a browser-based tool. The goal is **"best-in-class for hobbyist and prosumer coaster design,"** not **"replace Stengel Engineering's proprietary stack."**

These features assume the signed-velocity physics core, cumulative time/distance arrays, and pivot system from earlier sections are in place.

#### 6.10.1 Force envelope compliance checking (ASTM F2291 / EN 13814) **[T2]**

Real coasters must meet force envelope standards — plots of acceptable G magnitude vs. sustained duration, with separate curves for vertical (normal), lateral, and longitudinal forces, and for positive vs. negative G directions. ASTM F2291 (US) and EN 13814 (Europe) are the two major standards. Their envelopes are published graphs in the standards documents.

**Data model.** Encode each envelope as a piecewise curve of `(duration_seconds, max_g_magnitude)` pairs, one curve per (axis, direction, standard). Store as a JSON file in `packages/core/src/standards/`:

```json
{
  "standard": "ASTM_F2291_2024",
  "envelopes": {
    "normal_positive": [
      [0.0, 6.0],
      [0.2, 6.0],
      [1.0, 4.0],
      [10.0, 3.0]
    ],
    "normal_negative": [
      [0.0, -2.0],
      [1.0, -1.5],
      [10.0, -1.0]
    ],
    "lateral": [
      [0.0, 3.0],
      [1.0, 2.0],
      [10.0, 1.8]
    ],
    "longitudinal_positive": [
      [0.0, 6.0],
      [1.0, 5.0]
    ],
    "longitudinal_negative": [
      [0.0, -1.5],
      [1.0, -1.3]
    ]
  }
}
```

The values above are illustrative — **the actual envelope values must come from the standards documents themselves.** Don't hardcode made-up numbers; either get the PDFs and transcribe the curves, or leave placeholder data clearly marked as TODO until someone can.

**Algorithm.** For each axis, for each contiguous window of the node stream where the force exceeds a threshold, compute the window's duration. A violation occurs when the peak G in a window exceeds the envelope value at that window's duration:

```
for each axis in [normal, lateral, longitudinal]:
  for each direction in [positive, negative]:
    find all maximal windows where force(node) * direction > 0
    for each window:
      duration = cumulativeTime[window_end] - cumulativeTime[window_start]
      peak = max/min force in window
      envelope_limit = interpolate(standard.envelopes[axis][direction], duration)
      if |peak| > |envelope_limit|:
        emit violation(window, axis, direction, peak, envelope_limit)
```

Use linear interpolation between envelope points. Duration clamping: windows shorter than the envelope's first point use the first point's limit; windows longer than the last point use the last point's limit.

**Pivot dependence.** Run envelope checking at the currently-selected pivot (§6.3 pivot system). T2's multi-pivot expansion (§6.10.3) runs it at every enabled pivot and unions the violations.

**UI.**

- Violations appear as red shaded regions on the force graphs (§6.2) — normal violations on the normal graph, lateral on the lateral graph.
- Track mesh gets red segments for sections containing violations when "Compliance" is the active visualization mode (add to the color-mode options in §6.2).
- A compliance summary panel (toggleable) lists violations with: axis, peak value, envelope limit, duration, start time, section name. Click a violation → jump playhead to the start of the window.
- Standard selection in preferences (§14.4): `none` (disabled), `ASTM_F2291`, `EN_13814`, user-uploaded JSON. Default: `none` — compliance checking is opt-in because designers iterating on concepts don't want violation noise until they're ready to validate.

**Honest scoping.** This is a **design aid, not a certification.** The UI must make this clear — a prominent disclaimer in the compliance panel:

> "This tool checks geometric force profiles against published envelope curves. Actual certification requires a licensed engineer, full vehicle dynamics, and standards-body review. Do not use for safety-critical decisions."

**Milestone:** lands in M12 alongside T2 shuttle/bridge features, because envelope checking is more useful once the full section-type vocabulary is available.

#### 6.10.2 Jerk analysis **[T2]**

Jerk is `dG/dt` — the rate of change of acceleration. Low-jerk designs feel smooth; high-jerk designs feel abrupt even when peak G is moderate. Stengel's clothoid loop is famous precisely because it minimizes jerk at loop entry/exit compared to circular loops.

**Computation.** Finite-difference on the force arrays per axis:

```typescript
jerkNormal[i] = (forceNormal[i + 1] - forceNormal[i - 1]) * F_HZ * 0.5; // central difference
jerkLateral[i] = (forceLateral[i + 1] - forceLateral[i - 1]) * F_HZ * 0.5;
```

Units: `g/s`. Stored as a `Float32Array` per track, computed at recompute time alongside the existing smoothed/unsmoothed force arrays.

**UI.**

- Add a "Jerk" tab to the bottom-panel graphs, showing normal/lateral/longitudinal jerk over time.
- Add "Peak jerk (normal)" and "Peak jerk (lateral)" columns to the table view (§7.3) — these reveal which sections have the worst transitions at a glance.
- Color mode: add "Jerk magnitude" to the 3D viewport's color options, using `sqrt(jerkN² + jerkL²)` and a warning-colored gradient.
- Stats overlay (§7.6): show instantaneous jerk alongside the force readout.

**No violation thresholds.** Unlike envelope checking, there is no widely-standardized jerk limit (standards mention it qualitatively but don't publish hard numbers). Present jerk as information, not as pass/fail. Designers will learn what values feel good through practice.

**Milestone:** M13, alongside the other T2 analysis work.

#### 6.10.3 Multi-rider pivot analysis **[T2]**

A real train has riders at different positions — front vs. back car, and within a car at different seat rows. Forces at each position differ because the train's body has finite length (typically 7–15 m for a full train). The existing pivot system (§6.3) samples at one configurable offset; this extends it to _all_ seat positions simultaneously.

**Data model.** Add to the track's train configuration:

```typescript
interface SeatPosition {
  name: string; // "Front car, row 1", "Back car, row 2", etc.
  offsetMeters: number; // heart-distance offset from train reference point
  heartOffsetMeters: number; // per-rider heart height override (optional)
  enabled: boolean; // include in analysis
}

interface TrainConfig {
  seats: SeatPosition[]; // default: one seat at offset=0
  referencePoint: 'front' | 'middle' | 'back'; // what the playhead represents
}
```

At T2, the seat list is configured in the train-style JSON (§M14) — just add an array of offsets. At T3 with rigid-body sim, these become actual car positions in the simulated train.

**Computation.** For each frame/scrub update, for each enabled seat, look up the node at `playheadDistance + seatOffset` using the cumulative arrays. Compute forces at that node for that seat's heart offset. Store results as `Record<seatName, ForceSample>`.

**Envelope checking multi-pivot.** When compliance checking (§6.10.1) runs, iterate over all enabled seats instead of just the active pivot. Report violations with which seat they occur for — the front car typically has the worst airtime, the back car the worst ejector forces, etc.

**UI.**

- Stats overlay (§7.6): show a compact multi-seat table when multi-pivot is enabled: one row per seat, columns for N/L/longitudinal G.
- Compliance panel (§6.10.1): group violations by seat.
- Graph overlays: optionally plot force curves for all seats simultaneously (colored differently) in the curve view. For 15+ seats this gets noisy — provide a "front/middle/back only" simplified toggle.

**Milestone:** M14 when multi-car train rendering lands — same architectural change.

#### 6.10.4 Clothoid section type **[T2]**

A clothoid (Euler spiral / Cornu spiral) is a curve whose curvature increases linearly with arc length: `κ(s) = a + b·s`. It's the shape that gives the smoothest possible transition between straight and curved sections — Stengel's vertical loops use it because it produces bounded jerk where circular loops have discontinuous jerk at the transitions.

**Parameters.** A `ClothoidSection` takes:

- `entryCurvature`: starting curvature in rad/m (signed; 0 for tangent entry from a straight section).
- `exitCurvature`: ending curvature in rad/m.
- `arcLength`: total heart-length of the section in meters.
- `axis`: plane of the curve, in degrees from the track's current lateral axis (0 = pitch up, 90 = yaw right, etc.).
- `leadIn` / `leadOut`: optional smoothing at endpoints (same semantics as Curved sections).
- `rollFunc`: standard roll function like other sections.

**Integration.** At each 1000 Hz step, compute the instantaneous curvature `κ(s) = entryCurvature + (exitCurvature − entryCurvature) * (s / arcLength)` where `s` is the arc length traversed so far. The pitch/yaw rates are `κ * v` decomposed by axis angle. Everything else (velocity via energy, roll from the roll function) follows the existing integration pattern.

**Math reference.** Standard Fresnel integrals give the position explicitly:

- `x(s) = ∫₀ˢ cos(a·t + b·t²/2) dt`
- `y(s) = ∫₀ˢ sin(a·t + b·t²/2) dt`

where `a = entryCurvature`, `b = (exitCurvature − entryCurvature) / arcLength`. But for consistency with existing section types and to inherit all the velocity/energy bookkeeping, compute numerically via the standard integrator rather than using closed-form Fresnel values. The Fresnel form is only useful for validation tests.

**File format.** New section type in the JSON schema; enum extension for `.fvd` (though `.fvd` save will warn that `ClothoidSection` isn't FVD++-compatible, like `ReverseSection` from §6.6).

**UI.** Properties panel lists the four numeric fields plus axis plus lead-in/out. No new timeline graphs needed — it's a geometry-parameter section like Curved, not a force-function section like Forced.

**Milestone:** M13, alongside jerk analysis — the two are thematically linked (clothoids exist _because_ of jerk).

#### 6.10.5 Clearance envelope vs imported scenery **[T3]**

Builds on the Mesh reference asset feature (M13): users can import `.gltf` / `.glb` files as visual reference geometry. This feature extends that to collision detection — checking whether the track's clearance box intersects imported scenery.

**Clearance box.** Swept along the track at ±`clearanceLat` and ±`clearanceNorm` offsets from the heart line, by default matching FVD++'s 5 m-tall POV building border. User-configurable per track (different ride types have different clearance requirements: sit-down vs. floorless vs. flying).

**Collision test.** For each mesh reference asset, at each sampled track position (every ~0.5 m of heart distance), build an oriented bounding box for the clearance at that position and test intersection with the imported mesh. Use Three.js `Box3.intersectsObject` with proper transformation to the track's local frame at that position.

**Performance.** A 60-second coaster with 0.5 m mesh sampling is ~2000 tests per imported mesh per recompute. Worst case with 5 large meshes and BVH raycasting: ~50 ms on a laptop. Run on the worker, not the main thread.

**UI.**

- Track mesh colored red at sections with collisions when "Clearance" is the active visualization mode.
- Compliance panel gets a "Clearance violations" section listing each section with a collision, the offending mesh asset name, and the max intrusion depth.
- Cause-helpful error: "Train body intersects `Terrain.gltf` at section 12, 0.8 m intrusion. Either raise track or lower terrain at this location."

**Milestone:** M19, alongside other T3 features. Realistic because it reuses mesh import machinery from M13 and adds only collision logic on top.

### 6.11 NoLimits 2-inspired features

NoLimits 2 is the reference simulator in the coaster design space — used by Vekoma, Intamin, Gerstlauer, Mack, Maurer, and Stengel Engineering for client-facing visualization. It's a simulator and park designer, not a force-vector design tool, so most of its feature set is not relevant to WebFVD. But three ideas from NL2 translate well into our scope and would meaningfully improve the product without drifting from the FVD paradigm.

**Principle for this section:** take UX patterns that reduce user effort, skip anything that expands scope toward being a full simulator.

#### 6.11.1 Element library **[T2]**

NL2's element system lets users drag a pre-built vertical loop, corkscrew, cobra roll, Immelmann, zero-g roll, heartline roll, or wave turn into the track. The user tweaks a few parameters (height, width, rollover angle), the element expands into geometry, and it works.

In FVD++ and KexEdit, every inversion has to be built from force curves — users who know the physics can do it, but there's a steep learning curve before a designer can produce anything resembling a real element. NL2's library closes that gap.

**Data model.** An element is a **parameterized template** that expands into a sequence of WebFVD sections:

```typescript
interface ElementTemplate {
  id: string; // "vertical-loop", "cobra-roll", etc.
  displayName: string; // i18n key (common.elements.verticalLoop)
  category: ElementCategory; // "inversion" | "turn" | "hill" | "transition"
  parameters: ElementParameter[]; // user-tunable inputs
  /** Optional relative path to a preview SVG / PNG (see "Preview images"
   *  below). Resolved against the element-library bundle root. */
  previewImage?: string;
  expand: (params: Record<string, number>) => SectionDefinition[];
}

interface ElementParameter {
  id: string;
  displayName: string; // i18n key
  unit: Unit; // meters, degrees, g, etc.
  min: number;
  max: number;
  default: number;
}
```

The `expand` function is pure — given the parameter values and the current track state (entry velocity, entry orientation), it returns a list of section definitions to insert. It does not modify existing sections.

**Built-in elements (T2 initial set).** Each has an `expand` function that composes the existing section primitives:

- **Vertical loop** (parameters: height, entry G, exit G). Expands to three `Forced` sections: entry ramp (pitch up to vertical), loop body (clothoid-based per §6.10.4), exit ramp.
- **Cobra roll** (parameters: height, width, rollover duration). Expands to two half-loops with a heartline roll between them; five `Forced` + one `Geometric` section.
- **Immelmann** (parameters: height, exit angle). Half-loop followed by a half-roll exit; three sections.
- **Zero-G roll** (parameters: roll duration, peak G, roll rate). Single `Forced` section with a specific roll function and lateral G curve.
- **Heartline roll** (parameters: roll duration, entry/exit roll). Single `Forced` section with a roll-centered rotation.
- **Wave turn** (parameters: width, bank angle, duration). `Curved` section with a specific roll profile.
- **Camelback hill** (parameters: height, width, peak airtime G). `Forced` section with a force curve centered around the peak.
- **Corkscrew** (parameters: length, rotation direction). Two linked half-rolls; three sections.

The exact expansion math for each element should match reasonable real-coaster proportions — not rigorously physically optimized, just plausible starting points the user can refine afterward.

**Preview images.** Every element template ships a small preview graphic so the library picker reads at a glance rather than forcing users to decode element names:

- **Built-in elements** ship hand-drawn SVGs (≤4 KB each) showing the element's silhouette from a standard three-quarter angle. SVG keeps them crisp at any zoom and inlines into the bundle without a texture-loading round-trip.
- **Custom / imported elements** may include a raster `.png` (capped at 256 × 256 px). When a user saves a selection as a custom element, the app auto-generates a preview by rendering the selected sections through the existing Three.js pipeline to an offscreen canvas with a neutral material and the default three-quarter home angle, then encodes to PNG and stores it alongside the element data.
- The **element library picker** (left panel "Elements" tab) shows previews in a grid with the display name below; hover tooltips the parameter list.
- Previews travel inside the `.webfvd-element.json` as either a `"previewImage"` path reference (for bundles) or an inline `"previewDataUri"` (for single-file custom elements) so a single-file export stays self-contained.

**User-defined elements.** Users can save any contiguous selection of sections as a custom element. The save dialog asks:

- Element name.
- Which section properties become parameters (with min/max bounds).
- Whether the element should expand relative to entry conditions (default) or absolute (rare).
- Whether to auto-generate a preview image (default yes) or upload one.

Custom elements stored in IndexedDB under the user's profile, exportable as `.webfvd-element.json` files for sharing.

**UI.**

- Left panel gains a new **"Elements" tab** alongside "Sections". Tree view by category, searchable, with preview thumbnails in the grid.
- Drag an element onto the sections list to insert it at that position.
- Double-click to open a parameter dialog (with the same preview) before insertion.
- Right-click on selected sections → "Save as element..." for custom elements.
- Element insertions become a single undo-redo group.

**File format.** Element library files:

```json
{
  "version": 1,
  "id": "com.example.my-custom-loop",
  "displayName": "My Custom Loop",
  "category": "inversion",
  "previewImage": "previews/my-custom-loop.svg",
  "parameters": [],
  "sections": []
}
```

A bundle of elements is just a `.zip` containing multiple `.webfvd-element.json` files plus a `previews/` directory of referenced images; the UI supports importing zipped bundles.

**Milestone:** M15 or M16. It's a T2 feature that depends on the clothoid section type (M13) landing first, since several elements use clothoids in their expansion.

#### 6.11.2 Expanded track styles **[T2]**

FVD++ ships 8 track styles (Generic, GenericFlat, Vekoma, BM, Triangle, Box, SmallFlat, DoubleSpine). NL2 ships ~40. The difference is stark when a user wants to visualize a specific ride type — there's no way to render a B&M Floorless or a Vekoma Motorbike in FVD++ because those cross-sections simply aren't in the style library.

Expanding the style list is cheap (parameterized cross-sections, not licensed IP) and broadly improves coverage.

**New styles to add (T2 target, 12 additional):**

| Style                   | Approximate cross-section                                | Typical use                         |
| ----------------------- | -------------------------------------------------------- | ----------------------------------- |
| `InvertedGeneric`       | Two rails below, no spine below (train hangs)            | B&M Invert, Vekoma SLC lookalikes   |
| `FloorlessGeneric`      | Standard two-rail + single spine, car sits without floor | B&M Floorless lookalikes            |
| `WingGeneric`           | Two rails + central spine, seats on sides                | B&M Wing, Gerstlauer Infinity       |
| `FlyingGeneric`         | Two rails + spine, riders suspended                      | B&M Flying                          |
| `SpinnerGeneric`        | Standard two-rail, freely rotating car (visual hint)     | Mack Spinner, Maurer                |
| `LaunchGeneric`         | Heavier rails + LSM fin channel between                  | Intamin accelerator, Mack Stryker   |
| `HyperGeneric`          | Wider gauge, larger rail diameter                        | Intamin Mega, B&M Hyper             |
| `WoodenGeneric`         | Steel rails on wooden stack of laminated beams           | GCI, Gravity Group, Intamin pre-fab |
| `MineTrain`             | Narrow gauge, two rails only, thin spine                 | Arrow / Vekoma mine trains          |
| `FamilyGeneric`         | Thin rails, light cross-section                          | Zamperla family coasters            |
| `SuspendedGeneric`      | Monorail spine + bogey above, car swings below           | Arrow suspended                     |
| `BeyondVerticalGeneric` | Heavy spine, supports outrigger angle                    | Gerstlauer Euro-Fighter style       |

**Naming convention.** All new styles are suffixed `Generic` to make clear they are not licensed manufacturer profiles. Cross-section dimensions are chosen to _resemble_ the manufacturer style without matching any proprietary measurements.

**Implementation.** Each style is a data entry in a JSON file:

```json
{
  "id": "FloorlessGeneric",
  "railGauge": 1.09,
  "railRadius": 0.0475,
  "spineWidth": 0.25,
  "spineHeight": 0.3,
  "crosstieSpacing": 0.6,
  "crosstieSize": [0.1, 0.04],
  "heartOffset": 1.1,
  "variant": "two-rail-spine"
}
```

The `variant` field selects one of a small set of mesh generators (`two-rail-spine`, `two-rail-only`, `inverted`, `wooden`). Adding new styles usually means adding a data entry, not code — code changes only when a truly new topology appears.

**Legal care.** Do not use manufacturer names (B&M, Vekoma, Mack, Intamin, Gerstlauer) in style identifiers, file paths, UI strings, or i18n keys. Describe styles by _visual type_ ("floorless", "wing") or _ride class_ ("hyper", "family"). Never imply equivalence with or endorsement by any manufacturer.

**Milestone:** M16, alongside the T2 polish pass. Can be implemented incrementally — every couple of new styles is one PR.

#### 6.11.3 NL2 CSV export **[T1]**

FVD++ (and therefore WebFVD at M5) already imports NL2 CSV. We close the loop by also exporting. NL2 users who want to take a WebFVD-designed track into NoLimits 2 for rendering or client visualization get a straightforward path.

**Format.** NL2's CSV format is published — position and orientation vectors per node at a fixed sample rate. Confirm exact column order and sample spacing from NL2 documentation before implementing (don't guess).

**Implementation.** A new writer in `packages/core/src/io/nl2-csv-writer.ts`, symmetric to the existing reader. Golden test: export a track, re-import it into WebFVD, check that the cumulative geometry matches within tolerance.

**UI.** Add to the Export menu: "NoLimits 2 CSV…". Standard file dialog.

**Milestone:** M10, alongside the other NoLimits exporters. Half a day of work.

## 7. UI (redesigned)

FVD++'s Qt UI is three things fighting for space: the 3D viewport, the sections tree, and the graphs. The redesign gives each a proper role, and adds a **table view** and a **stats overlay** that FVD++ lacks but power users need.

### 7.1 Design philosophy — what to take from KexEdit, what to leave **[T1]**

We examined KexEdit carefully. Things to take:

- **Dope sheet ↔ curve view toggle** for timeline/graph editing. Best idea in the tool.
- **Keyframe shape encodes interpolation type**: square = constant, diamond = linear, circle = Bezier. Instantly readable.
- **Easing presets** on Bezier keyframes (Sine/Quadratic/Cubic/Quartic/Quintic/Exponential) with auto-detection of which preset the handles currently match. Makes the common case one click.
- **Override properties via a "+" button**: most properties have a default/inherited value, and the user only adds explicit control when needed. Keeps the UI clean.
- **Property carry-over**: values flow between sections automatically unless overridden. Right-click → Reset to inherited.
- **Pivot-dependent read-only curves**: force/speed graphs displayed alongside editable curves, computed at a user-selectable point on the train. Huge for tuning.
- **F3 stats overlay**: compact live readout at the current playhead position.

Things to **leave**:

- **The node graph** itself. It's unnecessarily complex and chunky for this problem — FVD is a linear sequence of sections, not a DAG. The boxes-and-wires layout adds visual weight (ports, edges, empty canvas space) without adding expressive power. A **sections list with drag-to-reorder** plus the table view (§7.3) conveys the same information in a fraction of the pixels. Bridge nodes and reverse-path nodes in KexEdit handle edge cases (shuttle coasters, complete circuits); we address those with explicit section types (`BridgeSection`, `ReverseSection`) in the linear sequence rather than a general-purpose graph.
- **Unity-isms**: KexEdit's look has game-engine polish that isn't right for a productivity tool. Aim closer to Figma / Linear / Blender 4.x defaults.

### 7.2 Layout **[T1]**

Three primary views, user-switchable via a top-left view switcher, plus persistent panels. POV is **not a separate view** — it's a camera mode of the editor's 3D viewport, reachable from any view (§6.3). This matters because it means playback, scene state, and edits all work identically whether you're watching from orbit or from the rider's seat.

- **Editor view (default):** 3D viewport + sections list + properties panel + timeline + playback bar.
- **Table view:** all sections across all tracks as a spreadsheet (§7.3).
- **Graph view:** full-window speed/force/roll/flexion graphs at high detail.

A **fullscreen toggle** (F11 or the maximize icon on the viewport) expands the 3D viewport to full window while keeping the playback bar and a minimal top bar. Combined with camera mode = POV, this gives you the classic "ride the coaster" experience without being a separate mode you have to exit to make an edit.

**Editor view layout** (resizable regions, persisted):

```
┌─ Top bar: view switcher · project name · save · export · lang · undo/redo ─┐
├────────────┬───────────────────────────────────────────┬───────────────────┤
│ Sections   │                                           │ Properties        │
│ (per track)│           3D viewport                     │ (selected section)│
│            │        (camera: Orbit/Follow/POV/Locked)  │                   │
│ Track A    │                                           │ [schema-driven]   │
│  • Anchor  │                                           │                   │
│  • Straight│                                           │                   │
│  • Forced  │                                           │                   │
│  + Track B ├───────────────────────────────────────────┤                   │
│            │ Playback bar: ⏮ ▶ ⏭  1×  ⟲  cam: Orbit ▼  │                   │
├────────────┴───────────────────────────────────────────┴───────────────────┤
│ Timeline (collapsible): dope sheet / curve view toggle · ruler · playhead  │
└────────────────────────────────────────────────────────────────────────────┘
```

The playback bar (§6.3) sits just below the 3D viewport and above the timeline. It's present in all views that contain the 3D viewport (i.e. Editor view and fullscreen viewport); in Table and Graph views, it lives in the top bar since the 3D viewport isn't visible.

Press `1`–`3` to switch views. Press `` ` `` (backtick) to cycle panel visibility in the editor view (three-panel / two-panel / viewport-only). Press `F11` to toggle fullscreen viewport. Press `V` to cycle camera modes.

### 7.3 Table view — the power-user view **[T1]**

KexEdit doesn't have this. It's worth building because:

- Compares parameters across many sections at a glance.
- Bulk edits (select 5 sections, change roll-speed degree to cubic).
- Find-and-replace on property values.
- Catches mistakes that are invisible in a graphical view (one section of 20 with the wrong orientation toggle).

Design:

- Rows = sections in **coaster order**. Grouped by track (collapsible headers). **Row order is the track's section order** and reflects edits made in the list view; it is never reorderable from within the table.
- Columns = properties. Default column set per track, saveable as presets.
- Frozen left column = section index + name + type icon. Always visible.
- **Sorting is disabled by design.** Column headers do not re-order rows — a coaster reordered by peak G is no longer the same coaster. Instead:
  - **Click a column header to highlight** the top/bottom N rows by that metric (e.g. highlight the 3 sections with the highest peak lateral G). The rows stay in place; a side bar indicator marks them.
  - **Filter row** below the headers: per-column text / range filters (e.g. `peakNormal > 4`, `type = Forced`). Filtering hides non-matching rows but never reorders them; hidden rows leave a compact "… 4 sections hidden …" spacer so the position in the track is still obvious.
  - **Jump-to-extreme** buttons on column headers: tiny ↑/↓ icons that scroll the table to the row with the max/min value in that column, without moving it.
- Click cell to edit. Multi-select + edit applies to all selected cells (e.g. select the 5 highlighted sections, change their roll-speed degree to cubic).
- Column chooser: show/hide any property. `Track style`, `Heart`, `Friction`, `Resistance`, `Speed override`, plus sub-function-level summaries (e.g. "Roll turns" = integral of roll speed / 360°).
- Right-click a row → jump to that section in editor view.
- Export table as CSV (analysis aid; not a project-saving format). CSV rows are in coaster order; filters do not affect export unless the user explicitly ticks "export visible rows only".

Implementation: use [TanStack Table](https://tanstack.com/table) v8 with virtualization. Don't build this from scratch.

### 7.4 Timeline (was "transition editor") **[T1]**

This is where designers spend most of their time. Adopt KexEdit's timeline model, adapted to FVD++'s data.

**Two modes, one shortcut to toggle (Tab):**

- **Dope sheet mode:** one row per function (Roll, Normal, Lateral, Pitch, Yaw, Speed-override). Keyframes shown as shapes on the row:
  - **Square** — `tozero`-like step/constant
  - **Diamond** — `linear`
  - **Circle** — `cubic` / `quartic` / `quintic` / `sinusoidal` (any smooth)
  - **Outlined circle** — `freeform` specifically
- **Curve mode:** each function's value plotted against time/distance on the same axes. Drag Bezier handles directly.

**Read-only overlay curves:** toggle to display speed/forces/flexion in the curve view, computed live at the **pivot** (a user-settable point on the train — not just heart center). Match KexEdit's behavior.

**Keyframe editing:**

- `I` — insert keyframe at playhead
- `V` — quick value editor
- `Delete` — remove selected
- `Ctrl+C` / `Ctrl+V` — copy/paste
- Arrow keys — nudge by 10 ms (1 ms at 1000 Hz is impractical). `Shift+arrow` by 100 ms. Configurable.
- Drag — move
- `Shift+drag` — constrain to horizontal or vertical

**Keyframe detail dialog** (double-click):

- Time/distance input with unit
- Value input with unit
- Interpolation dropdown: Constant / Linear / Bezier
- Easing preset (Bezier only): Sine / Quadratic / Cubic / Quartic / Quintic / Exponential
- Manual Bezier: in/out weights (0.0–1.0), in/out tangents (angle)
- Auto-detection: if handles match a preset after manual edit, show which

**Mapping to FVD++ internals:** each "keyframe" in our timeline corresponds to a subfunction boundary in FVD++'s `Func`. Adding a keyframe appends a subfunction with the chosen degree. Changing interpolation changes the subfunction's degree. Our UI hides the subfunction abstraction; the file format preserves it.

**Locked subfunctions:** shown as a padlock icon on the last keyframe of a section, indicating it extends to match section length.

### 7.5 Properties panel per section type **[T1]**

Schema-driven. Each section variant declares its properties; the panel renders them. Don't hand-write a panel per section type.

```typescript
type PropSchema = {
  key: string;
  labelKey: string; // i18n key, never a literal
  type: 'number' | 'enum' | 'bool' | 'vec3';
  unit?: 'm' | 'deg' | 'm/s' | 'g' | 's' | 'rad/s';
  min?: number;
  max?: number;
  step?: number;
  enumOptions?: { valueKey: string; labelKey: string }[];
  help?: string; // i18n key for tooltip
  advanced?: boolean; // hidden behind a "Show advanced" toggle
};
```

### 7.6 Stats overlay (F3) **[T1]**

Toggleable overlay in the 3D viewport, showing live values at the current playhead / camera pivot:

- Position (x, y, z) in m
- Velocity (m/s and km/h)
- Normal / lateral / roll forces (G)
- Roll, pitch, yaw (degrees)
- Roll speed (°/s)
- Flexion (°/m)
- Total length + heart length from anchor
- Time from anchor

Two modes: compact (single line at the viewport bottom) and expanded (labeled rows in a corner). User choice, persisted.

### 7.7 Starter experience **[T1]**

When the user opens the app with no project loaded, show a welcome screen with:

- **New project** — blank, anchor only.
- **Templates:** "Launched airtime coaster", "Classic lift + drop", "Inversion sampler", "Empty circuit (closed loop)". Each is a 2–5 section starter.
- **Open .webfvd.json or .fvd** (File System Access API where available).
- **Recent projects** (IndexedDB, last 10).
- **What's new** (versioned release notes, dismissible).

Templates are JSON files shipped with the app. They demonstrate each section type and good defaults for friction/resistance.

### 7.8 Accessibility **[T1]**

- All interactive elements reachable by Tab, with focus-visible styles.
- Number inputs accept typed values, not just drag.
- Respect `prefers-reduced-motion` — disable 3D camera inertia, snap transitions.
- Respect `prefers-color-scheme` — ship dark (default) and light themes, both WCAG AA.
- High-contrast mode toggle independent of theme.
- The 3D viewport is not accessible — that's fine, but the sections list, properties panel, table view, and timeline must fully support keyboard-only editing.
- Screen reader: sections list and table view labeled with ARIA; timeline and 3D viewport marked `aria-hidden` with a "switch to table view for accessible editing" hint.

## 8. I/O

### 8.1 Native JSON format (`.webfvd.json`) **[T1]**

Versioned, schema-checked, human-diffable. This is the default save format.

```jsonc
{
  "format": "webfvd",
  "version": 1,
  "project": {
    "texturePath": "…",       // legacy compat; optional
    "tracks": [
      {
        "name": "Main track",
        "style": "Generic",
        "heart": 1.1,
        "friction": 0.021,
        "resistance": 1e-5,
        "startPos": [0, 10, 0],
        "startYaw": 0,
        "startPitch": 0,
        "sections": [ … ],
        "smoothers": [ … ]
      }
    ]
  }
}
```

Use a Zod schema. Loader validates on read, gives actionable errors. Version bumps go through an explicit migration function.

### 8.2 Legacy `.fvd` binary (read + write) **[T1]**

**Magic:** ASCII `"FVD"` + ASCII version `"v0.77"` (current) or `"v0.30"` (legacy). See `ui/projectwidget.cpp:358` (save) and `ui/projectwidget.cpp:379` (load).

**Byte order:** `writeBytes` in `core/exportfuncs.cpp` **reverses** the byte order of each field — effectively big-endian on little-endian hosts. Match this. In JS: read with `DataView` using `littleEndian = false`.

**Structure (high level — confirm against source):**

```
"FVD"                     // 3 bytes
"v0.77"                   // 5 bytes
int32  texPathLength
bytes  texPath            // UTF-8, length bytes
repeated "TRC" + <track>  // one per track
"EOP"                     // end of project
```

Each track contains project settings, anchor, sections list. Each section: type tag, common fields, then type-specific fields. Each section contains functions; each function contains subfunctions.

**Method:** write a faithful `DataView`-based reader in `packages/core/src/io/fvd/reader.ts`, mirroring the C++ read order exactly. The writer mirrors the C++ save order. Both go through a shared `FvdStream` helper that handles the reversed-byte-order writes.

**Testing:** the `tools/fvd-dump/` CLI reads a `.fvd` and writes the resulting in-memory `Project` as JSON. Round-trip test: `.fvd → Project → .fvd`, compare byte output to original (after sorting any order-sensitive lists).

### 8.3 NoLimits 1 `.nlelem` export **[deferred — see §20b]**

`core/track.cpp` `exportTrack`, `exportTrack2`, `exportTrack3`, `exportTrack4` — four variants for different track layouts. Port `core/exportfuncs.cpp` helpers. Moved out of the T1 ship scope: `.fvd` (§8.2) is the canonical interop target for T1. NL1/NL2 exporters land once we have real goldens to diff against.

### 8.4 NoLimits 2 export **[deferred — see §20b]**

`core/track.cpp` `exportNL2Track` (~line 796). Outputs a specific binary format and/or CSV. Check the actual byte output of FVD++ 0.79 against your output on the golden test coasters. NL2 import files in their editor — you must produce byte-identical files, not "equivalent" ones. Also deferred; see §20b for rationale.

### 8.5 NL2 CSV import **[deferred — see §20b]**

`core/nolimitsimporter.cpp` + `core/secnlcsv.cpp`. Creates a section populated from a CSV of pre-computed node data. Deferred alongside the NL1/NL2 exporters.

## 9. State, undo/redo

Command log pattern. Port `core/undoaction.cpp` (808 LOC) and `core/undohandler.cpp` (343 LOC). Each action has `apply()` and `revert()`. The Zustand store holds `past: Action[]`, `future: Action[]`, `present: Project`.

Every UI mutation goes through `dispatch(action)`, never direct state writes. This is also how recompute is triggered: after `apply`, the worker is notified which sections from the modified one onwards need reintegration.

### 9.1 Shape of an undoable action

```typescript
interface UndoableAction {
  /** Stable ID used for coalescing (see §9.4) and for i18n of the
   *  history panel label. Examples: "section.patch",
   *  "section.add.bezier", "bezier.handle.drag". */
  readonly kind: string;
  /** Short human-readable label for the history panel and undo tooltip,
   *  through `t()`. Example: "Change pitch rate of Curve 3". */
  readonly label: string;
  /** Monotonic timestamp (`performance.now()`) at the moment the action
   *  was applied. Used to group rapid successive edits (§9.4). */
  readonly timestamp: number;
  /** Pure functions — no store mutations outside these two. Produce the
   *  next and previous `Project` snapshot respectively. Immutable
   *  in; immutable out. */
  apply(project: Project): Project;
  revert(project: Project): Project;
}
```

Actions capture enough information in their closure to revert without reading back live state. For a property edit: `(kind: 'section.patch', sectionIndex, key, prevValue, nextValue)`. For a structural change (add / remove section): the full section payload + its position.

### 9.2 Scope boundaries

- Undo applies to the **project only.** View state (camera position, render-style toggle, graph collapse, selected section, cube projection) is **not** undoable. Users don't expect "undo" to move their camera.
- **File operations** (Open, Save, Save As, Load Demo, New Project) clear the stack. Opening a new project is a discrete step, not part of the edit history.
- **Imported-geometry edits** to `NoLimitsCSV` sections aren't allowed in M3, so there's nothing to undo there until the M5 import pipeline lets users delete/rename that section. Once it does, the deletion IS undoable.
- **Preferences** (§14.4, M8) live in their own store slice and have their own minimal history; they don't share a stack with the project.

### 9.3 UI surface

- **Keyboard:** `Cmd/Ctrl+Z` undo, `Cmd/Ctrl+Shift+Z` redo, `Cmd/Ctrl+Y` redo (Windows convention). Scoped to the document area — ignored while the user is inside a text input unless the native browser undo has nothing to do (we let the input win for typing inside a field).
- **Menu:** `Edit → Undo <label>` / `Edit → Redo <label>` with the action label appended so users know what they're about to undo. Disabled when the stack is empty.
- **Status line:** the bottom-right dirty marker (`*` next to the project name) reflects "has changes since last save" — not "undo stack is non-empty." A saved project with 20 undoable edits is clean; `Ctrl+Z` on it doesn't break that invariant but DOES re-mark the project dirty.
- **History panel** (M8, optional): a collapsible side rail listing the last 50 actions by label + timestamp, with click-to-jump-to-state. Out of scope for T1 beyond keyboard + menu.

### 9.4 Coalescing & throttling

Some edits produce many actions in rapid succession — scrub a slider, drag a Bezier handle, type into the name field. A naive stack would fill with hundreds of steps for one logical change.

Rules:

- **Coalesce by `kind` + stable target key within a debounce window** (default 350 ms since the previous action with the same `(kind, target)` signature). The combined action's `revert` uses the ORIGINAL `prevValue` from the first edit; `apply` uses the LATEST `nextValue`. Timestamp is kept at the latest.
- **Drag interactions** (Bezier handle, timeline keyframe once it lands) emit a single action at drag end — the in-flight movement is visual only. This matches the current draggable-handles implementation.
- **Coalesce opts** attached to each action kind: some never coalesce (add / remove section), some always coalesce within the window (property patches, roll-function keyframe drag), some coalesce with an inactivity-only variant (name field: coalesce until focus leaves the input). Defaults documented in `packages/core/src/undo/coalesce-rules.ts`.

### 9.5 Recompute integration

The worker (§5, M2+) integrates the physics lazily on a project change. Undo must:

- Fire the same recompute pipeline `apply` does. Revert returns a `Project`; the store subscription triggers recompute like any other change. No special path.
- Optionally remember the **first section index affected** in the action metadata so the recompute RPC can do an incremental pass instead of a full retrace. M6 smoothing already caches by index; undo can reuse that cache by passing the saved affected index through (T2 perf tuning, not required for correctness).

### 9.6 Stack limits + memory

- **Max stack depth:** 200 undo steps (per project, per `past` / `future`). Older actions discarded FIFO. Configurable in preferences.
- **Snapshot strategy:** actions store deltas (key + prev + next), not full-project snapshots. A 60-section project edit averages ≤ 500 bytes per action; 200 actions ≤ 100 KB.
- **Structural snapshots** (add / remove section / add keyframe) store the affected section object plus its position — larger but bounded by section count.
- **Autosave** (§14.3, M8) snapshots the full project, not the undo stack. Re-opening an autosave restores `present` only; the stack is empty (matches the "open clears stack" rule).

### 9.7 Persistence across sessions

Undo stack does **not** persist across reloads or new tabs in the initial cut. Rationale: the reload-cleared-stack matches every other tool in this class, avoids a schema-versioning headache for action payloads, and removes a class of "I can't reproduce this bug" reports where someone undoes to a state from a different version of the app. Revisit if users ask.

### 9.8 Milestone phasing

- **M0 / M1 scaffold:** empty store slice for `past` / `future` + dispatch signature. No-ops until an action type exists.
- **M4 wiring:** the schema-driven properties panel is the first place actions land — its field-change callback dispatches `section.patch` actions instead of calling `patchSelectedSection` directly. Keyboard shortcut handlers added. Menu items added. Coalesce rules for property edits.
- **M5 structural actions:** add / remove section, reorder (drag-to-reorder in the sections panel becomes an undoable `section.reorder`).
- **M7 Bezier handle drag:** drag-end dispatches a single `bezier.handle.drag` action with the start and end positions.
- **M8 history panel (optional):** visual list of the last N actions, click-to-jump. Preference for max stack depth.
- **T2 (M11+):** signed-velocity-aware actions — reversing a shuttle's direction while editing backward motion integrates correctly through undo.
- **T3 (M18+):** switch-state actions for the DAG (flipping a SwitchSection at runtime is NOT undoable — it's a play-mode event, not a design edit).

## 10. Testing

The physics is the risky part. Build the test harness **before** porting the integrators.

### 10.1 Golden file tests

1. Build FVD++ 0.79 locally once (or use SecretImbecile's maintained fork).
2. Hand-craft ~15 `.fvd` files that exercise each section type, each transition type, smoothing, and joint boundaries.
3. Use the C++ to dump the 1000 Hz node stream per file to CSV. This is the source of truth.
4. In `packages/core/test/`, load each `.fvd`, run the TS integrator, compare to the CSV. Tolerance: `1e-4` on position, `1e-5` on forces — account for float32 vs float64 differences.

### 10.2 Round-trip tests

- `.fvd → Project → .fvd` must be byte-identical for all golden files.
- `Project → JSON → Project` must be structurally identical.
- `NL2 export` of known coasters must be byte-identical to FVD++ 0.79's output.

### 10.3 Property-based tests

For each section type, generate random valid parameters (via `fast-check`). Verify:

- Integration doesn't NaN.
- Energy conservation holds to within friction losses.
- `node.norm == cross(node.dir, node.lat)` to float precision after every step.

## 11. Performance budget

- **Worker recompute full track (60k nodes):** ≤ 100 ms on a mid-range laptop. The C++ manages this easily; TS with typed arrays should too.
- **Partial recompute from section N:** ≤ 30 ms for a 50% change.
- **Main-thread frame:** always 60 fps. If the graph redraw costs more than 8 ms, throttle to rAF-coalesced updates.
- **Memory:** < 200 MB for a 5-minute multi-track project.

Profile early. The hot path is `SubFunc.getValue()` — it's called once per node per function per section, and there are 3–5 functions per section. Keep it allocation-free.

## 12. i18n

### 12.1 Setup

```
packages/app/src/i18n/
├── index.ts                    # i18next init
└── locales/
    ├── en/
    │   ├── common.json
    │   ├── editor.json
    │   ├── sections.json
    │   ├── functions.json
    │   ├── export.json
    │   └── errors.json
    └── de/
        └── (same files)
```

Language detector: browser setting, with manual override in the top bar (persisted to `localStorage`).

### 12.2 Rules

- No literal user-facing strings in JSX. Ever. ESLint rule `react/jsx-no-literals` set to warn, or a custom rule.
- Units are translated (`"m"`, `"deg"`) even when short, because German sometimes prefers `"°"` or `"Grad"`.
- Error messages from core **return error codes**, not strings. The app translates. Core must remain locale-agnostic.
- Pluralization via i18next's plural forms (`count` variable).
- Date and number formatting via `Intl`. Decimal separator differs (1.5 vs 1,5) — input fields accept both.

### 12.3 Number input and decimal separators

German-speaking users type `1,5`. English-speaking users type `1.5`. Both must work in every numeric input.

- Parse both separators on input. Accept whichever the user types.
- Format according to `Intl.NumberFormat(locale)` on display.
- **Internally, all numbers are JS `number` (IEEE 754).** Never pass formatted strings around.
- Copy/paste: pasting `"1,5"` into an input in EN locale must still parse as `1.5`. Pasting a range like `"1,5-2,0"` into a single input must fail with a helpful error, not silently become `1.5`.
- CSV export uses `.` regardless of locale (it's a machine format).

### 12.4 Initial DE translation

Draft DE by Claude Code on first pass; needs human review before shipping — coaster-design German has established terminology (e.g. "Herzlinie" for heartline, "Querbeschleunigung" for lateral G, "Wendebereich" for reversal). The FVD++ German coaster community has conventions. If uncertain, leave a `// TODO(i18n-de): verify term` comment rather than inventing.

## 13. Keyboard shortcuts

Defined once, in `packages/app/src/keybindings.ts`. Discoverable via `?` (shortcut cheat sheet overlay). Customizable in a later version — not v1.

### Global

| Shortcut                  | Action                                    |
| ------------------------- | ----------------------------------------- |
| `Ctrl+S`                  | Save project                              |
| `Ctrl+Shift+S`            | Save as                                   |
| `Ctrl+O`                  | Open project                              |
| `Ctrl+E`                  | Export (opens export dialog)              |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo                               |
| `Ctrl+Y`                  | Redo (alt)                                |
| `1` / `2` / `3`           | Switch to Editor / Table / Graph view     |
| `F3`                      | Toggle stats overlay                      |
| `F11`                     | Toggle fullscreen 3D viewport             |
| `?`                       | Shortcut cheat sheet                      |
| `Esc`                     | Close dialog / cancel current interaction |

### Playback (active in any view that shows the 3D viewport)

| Shortcut              | Action                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Space`               | Play / pause                                                                                                                                                                                                  |
| `K`                   | Play / pause (alt, video-editor muscle memory)                                                                                                                                                                |
| `J` / `L`             | Step back / forward 1 second                                                                                                                                                                                  |
| `Shift+J` / `Shift+L` | Step back / forward 0.1 second                                                                                                                                                                                |
| `,` / `.`             | Previous / next section boundary                                                                                                                                                                              |
| `Home` / `End`        | Playhead to track start / end                                                                                                                                                                                 |
| `[` / `]`             | Decrease / increase playback speed (cycles 0.25·0.5·1·2·4·8)                                                                                                                                                  |
| `0`                   | Reset playback speed to 1×                                                                                                                                                                                    |
| `V`                   | Cycle camera mode (Orbit → Follow → POV → Locked → Orbit)                                                                                                                                                     |
| `Shift+V`             | Reverse cycle camera mode                                                                                                                                                                                     |
| `L`                   | Cycle loop mode (off → track → section → off). **Note:** conflicts with step-forward above; in practice `L` steps forward and `Shift+Alt+L` toggles loop — final binding to be confirmed by first-use testing |

### POV camera (active when `cameraMode === 'POV'`)

| Shortcut              | Action                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `↑` / `↓`             | Shift POV offset along forward axis                                            |
| `←` / `→`             | Shift POV offset along lateral axis                                            |
| `PageUp` / `PageDown` | Shift POV offset along normal axis                                             |
| `R`                   | Reset POV offset to default                                                    |
| `Shift+drag` (mouse)  | Look around (decouple view from track orientation briefly) — release to resnap |

### Editor view

| Shortcut          | Action                                                           |
| ----------------- | ---------------------------------------------------------------- |
| `` ` ``           | Cycle panel visibility (three-panel / two-panel / viewport-only) |
| `Ctrl+N`          | New section (opens type picker)                                  |
| `Delete`          | Delete selected section                                          |
| `Ctrl+D`          | Duplicate selected section                                       |
| `↑` / `↓`         | Select previous / next section (when sections list focused)      |
| `Alt+↑` / `Alt+↓` | Move selected section up / down                                  |
| `Tab`             | Timeline: toggle dope sheet / curve view                         |

### Timeline

| Shortcut              | Action                                                        |
| --------------------- | ------------------------------------------------------------- |
| `I`                   | Insert keyframe at playhead                                   |
| `E`                   | Quick value editor on selected keyframe (`V` is camera cycle) |
| `Delete`              | Delete selected keyframes                                     |
| `Ctrl+C` / `Ctrl+V`   | Copy / paste keyframes                                        |
| `←` / `→`             | Nudge keyframe by 10 ms (when timeline focused)               |
| `Shift+←` / `Shift+→` | Nudge keyframe by 100 ms                                      |
| `Shift+drag`          | Constrain drag to horizontal / vertical                       |

### 3D viewport (mouse + orbit/follow modes)

| Shortcut    | Action                                    |
| ----------- | ----------------------------------------- |
| `F`         | Frame selected section                    |
| `A`         | Frame all                                 |
| `B`         | Toggle NL1 building border (FVD++ parity) |
| Middle-drag | Pan                                       |
| Right-drag  | Orbit                                     |
| Scroll      | Zoom                                      |

### Shortcut conflicts — to resolve during M7

The above has two places where video-editor conventions (J/K/L for scrub+play, `V` for select) collide with other natural bindings. Claude Code should resolve these at M7 time by building it and seeing what feels right, not pre-committing now. Document the final bindings in the cheat sheet overlay. If unresolved, default to the video-editor conventions (J/K/L, and use `C` for camera cycle instead of `V`) — most users of a playback-heavy tool will recognize them faster.

## 14. Persistence & auto-save

### 14.1 Auto-save

FVD++ writes a `.bak` on every export. The web has no filesystem by default; use IndexedDB.

- Every 30 seconds after the last edit, serialize the project to JSON and write to IndexedDB under key `autosave:<projectId>`.
- Keep the last 5 autosaves per project (rolling).
- On app start, if autosaves exist but no project is open, offer "Restore autosave from <timestamp>?" on the welcome screen.
- Auto-save is **silent** — no toast, no spinner. Only surface if it fails (e.g. storage quota exceeded).

### 14.2 Explicit save

- **File System Access API** where supported (Chromium-based browsers as of 2026): remembers the file handle, one-click re-save.
- **Fallback**: download link with suggested filename. Open replaces the current project.
- Save format is `.webfvd.json` by default. "Save as legacy .fvd" is an explicit separate action.
- On close with unsaved changes: `beforeunload` confirmation prompt.

### 14.3 Recent projects

IndexedDB, last 10 opened, per-browser. Shown on welcome screen and in `Ctrl+O` dialog. Clearable via Preferences → Clear recent.

### 14.4 Preferences

User preferences live in `localStorage` under a single `webfvd:prefs` key with a Zod-validated schema. Migrations handled like project format migrations.

Contents:

- **Appearance:** theme (light/dark/auto), panel sizes, background color, grid visibility + color.
- **Language:** `en` | `de` (§12).
- **Units:** measurement system (§4.5), time-ms threshold (when to auto-switch from s to ms), dual-unit label visibility.
- **Playback defaults:** default speed multiplier, default loop mode, default camera mode, default POV offset (`vec3`).
- **3D quality:** mesh quality (1/2/4/6), shadow quality (off/medium/high), FOV, anti-aliasing.
- **Graph colors:** per-function gradient endpoints (4-stop gradient for `roll`, `normal`, `lateral`, `pitch`, `yaw`) — ports FVD++'s `rollColor[4]` etc.
- **Nudge step** for keyboard property editing (§13).
- **Default pivot** for read-only graph overlays (§7.4).
- **Train visibility** in playback (scale factor 0–2, default 1).
- **Recent projects list** (up to 20 entries with paths + last-opened timestamps).

## 15. Error recovery

- **Corrupt `.fvd` on load:** show the actionable error (byte offset, what was expected), offer to open in hex view (a readonly panel that highlights the failing offset).
- **Schema validation failures on JSON load:** Zod errors rendered human-readably; offer "Open anyway and try to recover" which loads partial project with warnings per-section.
- **Worker crash / infinite loop:** the main thread times out recompute at 5 seconds, terminates the worker, shows "Recompute failed on section X (timeout). Check the values — if they look fine, please report this." Main thread remains responsive; user can still edit.
- **IndexedDB quota exceeded:** prompt to clear old autosaves or recent projects. Never silently drop data.
- **Unhandled exceptions:** `window.onerror` + `onunhandledrejection` → sourcemap-friendly error report dialog with copy-to-clipboard stack + project snapshot. User decides whether to share (no auto-upload).

## 16. Privacy & telemetry

**No telemetry. No analytics. No third-party scripts. No cookies beyond what's needed for the app itself (language preference, panel sizes — all local-storage, same-origin).**

State this explicitly in the app's About dialog, the README, and the website footer. The target audience is privacy-conscious by default; violating that is a one-way ticket to losing trust.

- No Google Fonts, no CDN-hosted libraries loaded at runtime. Everything bundled.
- No error-tracking services (Sentry etc.) without an explicit opt-in toggle in preferences, default **off**.
- The PWA must work fully offline after first load.
- No referer leakage: set `Referrer-Policy: no-referrer` on the hosting page.

## 17. Browser support

**Target browsers:** latest stable and one previous major of Chrome/Edge, Firefox, Safari.

Concretely, as of 2026:

- Chrome / Edge 120+
- Firefox 115+ ESR, 125+
- Safari 17+

**Feature detection:**

- **File System Access API**: present → use it; absent → fall back to `<input type="file">` + download.
- **WebGL2**: required. No WebGL1 fallback. Show a clear "WebGL2 required" message with a link to `https://get.webgl.org/webgl2/`.
- **Web Workers**: required. If missing (ancient browser, weird config), show "Your browser is not supported."
- **IndexedDB**: required for autosave and recents. If blocked (private mode in some configs), degrade gracefully — warn once, everything except autosave still works.

Mobile Safari and Chrome for Android: the app must load and render without crashing, but the UI is not designed for touch. Show a one-time "This app is designed for desktop. Tablet works in a limited way; phone is not supported." banner, dismissible.

## 18. Distribution

- **Hosting:** static site on Cloudflare Pages or GitHub Pages. No backend.
- **Domain:** TBD. Until then, GitHub Pages URL.
- **PWA:** installable. `manifest.webmanifest` with icons, theme color, display `standalone`. Service worker caches the app shell for offline use.
- **Update flow:** service worker detects new version, shows a "Reload to update" toast. Does not force-reload.
- **Source-available:** repo is public from day one, AGPL-3.0, with a clear contributing guide.

## 19. Milestones

Organized by tier. Each tier ends with a **release** — an actually shippable public build. Don't skip ahead. The checkpoint at the end of each tier is not "we tagged a version," it's "someone can use this to do real work."

### Tier 1 — "FVD++ in the browser with a modern UI"

**Ship target:** a usable replacement for FVD++ 0.79 that runs in Chrome/Firefox/Safari, reads existing `.fvd` files, supports all the section types FVD++ has, and exports to NoLimits 1/2. No modern features, no node graph, no multi-car trains.

#### M0 — Scaffold **[T1]**

- Monorepo, packages, TypeScript strict, Vite dev server, basic app shell.
- i18next wired, EN + DE stubs, language switcher in top bar.
- Zustand store, empty command log.
- CI pipeline (lint, typecheck, test, build) on GitHub Actions.
- Deployed to a preview URL on every commit to `main`.
- No physics, no 3D.

#### M1 — Data model + JSON I/O **[T1]**

- All types per §4 (`Project`, `Track`, `Section*`, `Func`, `SubFunc`, `MNode` SoA).
- JSON save/load with Zod schema validation, versioned with explicit migration function (§8.1).
- File System Access API with `<input type="file">` + download fallback.
- Unit policy (§4.5): format/parse helpers, SI internal, three measurement systems available (the switcher can already be used).
- Golden test: create a tiny project in code, save, load, compare structurally.

#### M2 — First integrator: Straight + Anchor **[T1]**

- Worker wrapper, Comlink RPC surface.
- `MNode` SoA with `Float32Array` fields, transferable buffers between worker and main.
- Straight section integration.
- **Cumulative time/distance arrays** (§5.4) wired in parallel with node stream.
- Basic Three.js scene: line-strip of heart positions, no mesh yet. Fusion 360 navigation (§6.4) with `Middle-drag` pan, `Shift+Middle-drag` orbit, scroll zoom.
- Sections list panel, schema-driven properties panel for Anchor and Straight.
- Golden test: hand-built straight-section projects verify position/velocity/distance against expected values.

#### M3 — Functions, SubFunctions, Curved **[T1]**

- Full `SubFunc.getValue` port with all 9 degree types (§5.2). The 9 degrees are the exotic bit — tested individually.
- `Func` container with locking logic.
- `Curved` integrator.
- **Speed + force graphs** (uPlot), synced to section selection.
- **Timeline v1**: dope sheet mode, keyframe shapes (square/diamond/circle), interpolation dropdown. No curve view yet, no Bezier handles.

#### M4 — Forced + Timeline v2 **[T1]**

- `Forced` integrator, time-domain and distance-domain variants (`bArgument`).
- Euler vs Quaternion orientation (`bOrientation`).
- **Timeline v2**: curve view mode (Tab toggle), Bezier handle dragging, easing presets with auto-detect (Sine/Quadratic/Cubic/Quartic/Quintic/Exponential), keyframe detail dialog.
- Timewarp (`centerArg`, `tensionArg`) exposed via draggable handles.
- Roll + flexion graphs.
- **Unit conversion flow** (§5.5): editing derived-unit values offers to switch argument type.

#### M5 — Geometric + Bezier sections **[T1]**

- `Geometric` integrator (pitch/yaw rates instead of forces).
- `Bezier` section type with arc-length reparameterization.
- NL2 CSV import into `NoLimitsCSV` section.
- All FVD++ section types now functional.

#### M6 — Smoothing + pivot + stats overlay **[T1]**

- Port `smoothhandler.cpp`.
- Smooth force overlay in graph (original vs smoothed, toggleable).
- Pivot setting (Track → Pivot…) — governs read-only overlay curves and stats panel.
- Read-only overlay curves in timeline curve view (KexEdit's "read-only curves button").
- **F3 stats overlay** in 3D viewport with dual-unit display.

#### M7 — Track mesh + color modes + playback **[T1]**

- **Full track mesh** per §6.1: adaptive tessellation, all 8 track styles with their exact cross-sections, mesh quality levels.
- **Force/flexion/roll-speed color modes** (§6.2) with user-customizable gradient endpoints.
- **Shadow maps** (Three.js built-in PCF).
- **Passive supports** from `.fvd` `supList` rendered as vertical columns (§6.5 Option A).
- **Playback system** (§6.3): signed heart-distance playhead, play/pause/scrub, speed multiplier, loop modes, J/K/L shortcuts.
- **Four camera modes**: Orbit, Follow, POV, Locked.
- Optional **Fly mode** (right-click-hold + WASD) as alternative free camera.
- **Single-point train model** at the playhead, user-scalable (§6.3 T1).
- **Playback bar** below 3D viewport with unit-toggleable time/distance readout.
- POV offset controls via arrow keys, building-border `B` toggle.
- Fullscreen viewport toggle (F11).
- Timeline playhead synced bidirectionally.

#### M8 — Table view + welcome + autosave **[T1]**

- **Table view** per §7.3 (TanStack Table, no sorting, filter row, highlight/jump-to-extreme, bulk edit, column presets, CSV export).
- **Welcome screen** with templates, recent projects list, "what's new".
- **Autosave** to IndexedDB (30s interval, rolling 5 per project).
- **Preferences** panel (§14.4) — theme, language, units, playback defaults, 3D quality, graph colors.

#### M9 — Legacy `.fvd` I/O **[T1]**

- Binary reader (§8.2) with `DataView`, reversed byte order, full structure.
- Binary writer, producing byte-identical output to FVD++ for golden files.
- Round-trip test against ~15 golden `.fvd` files covering all section types.
- Retro-fit M2–M6 golden physics tests to use real `.fvd` inputs now that we can read them.

#### M10 — NoLimits exporters + T1 ship **[T1]**

- NL1 `.nlelem` writer (4 exporter variants from `track.cpp`).
- NL2 binary export (`exportNL2Track`).
- **NL2 CSV export** (§6.11.3): symmetric writer to the existing CSV reader; File → Export → "NoLimits 2 CSV…". Round-trip golden test (export → re-import → cumulative geometry matches within tolerance).
- Byte-match test against FVD++ 0.79 outputs for the golden set. Any mismatch is a bug; document or fix.
- **T1 Release checklist:**
  - DE translation reviewed by human.
  - Error recovery (§15) fully wired.
  - Shortcut cheat sheet (`?` overlay).
  - Docs page: "Coming from FVD++" guide.
  - PWA manifest, offline app shell.
  - **Ship publicly.** Post on NoLimits-Exchange, coasterforce, r/rollercoasters.

### Tier 2 — "Beyond FVD++: topology, shuttles, KexEdit features"

**Ship target:** the tool KexEdit users would recognize as a peer. Closed-loop circuits, shuttle coasters with rollbacks, multi-car train visualization, the optimizer. Still targets NoLimits export; still uses the underlying physics from T1.

#### M11 — Backwards motion & shuttle support **[T2]**

- **Signed velocity** per §6.6: `MNode.vel` semantics extended, energy recovery preserves direction, position updates use signed velocity.
- **`ReverseSection`**: new section type, zero-length velocity reflection event.
- **Direction tracking**: reversal detection at near-zero velocity.
- **Playhead is chronological, not spatial**: scrubber and timeline show out-and-back continuously.
- **NL2 exporter** emits shuttle-mode tags for reversal sections.
- **NL1 exporter** refuses reversals with a clear error.
- **`.fvd` save** warns about data loss if reversals present; JSON is lossless.
- Golden tests with hand-built shuttle projects (JSON-only; no FVD++ reference exists for signed-velocity behavior).

#### M12 — Bridges, complete circuits & envelope compliance **[T2]**

- **`BridgeSection`**: takes two anchor endpoints, generates a Catmull-Rom spline connector (per KexEdit `docs/user-guide/complete-circuits.md`).
- **Closed-loop detection**: project validation flags unclosed intentional-loop tracks.
- **Recompute across bridges**: velocity and forces at bridge exit come from the bridge integration, so the circuit is physically consistent.
- Bridge UI: drop a bridge into the sections list, select source anchor and target anchor.
- **Force envelope compliance checking** (§6.10.1): ASTM F2291 / EN 13814 envelope JSON files, violation detection on the node stream, red shading on the force graphs, "Compliance" color mode on the track mesh, compliance summary panel with the "design aid, not a certification" disclaimer, preference for standard selection (`none` default).

#### M13 — Copy-path, optimizer, mesh assets, jerk & clothoids **[T2]**

- **`CopyPathSection`** (§6.7 T2): references another section, reuses its node geometry while recomputing forces from the new anchor. Enables KexEdit-style shuttle composition (`docs/user-guide/shuttle-coasters.md`).
- **Reverse-path operation**: a CopyPath variant that traverses the source section backward.
- **Optimizer** per §6.9: gradient descent for roll/pitch/yaw targets. Right-click keyframe → Optimize submenu.
- **Mesh reference assets** (KexEdit Mesh nodes): import `.gltf` / `.glb` files as visual-only reference geometry (terrain, nearby buildings). No physics interaction.
- **Jerk analysis** (§6.10.2): per-axis finite-difference on the force arrays, new "Jerk" graph tab, peak-jerk columns in the table view, jerk-magnitude color mode, instantaneous jerk in the stats overlay. No pass/fail thresholds — information only.
- **Clothoid section type** (§6.10.4): `ClothoidSection` with `entryCurvature` / `exitCurvature` / `arcLength` / `axis` / leadIn / leadOut / `rollFunc`. Integrated numerically at 1000 Hz alongside the other section types. JSON schema extension; `.fvd` save warns on non-FVD++-compatible section.

#### M14 — Multi-car train rendering & multi-rider pivot analysis **[T2]**

- **Multi-car visual** per §6.3 T2: JSON train-style configuration (front/middle/back car meshes, wheel assembly, 1–20 cars).
- **KexEdit train-style compat**: drop KexEdit's `trains/*.json` + meshes into WebFVD's trains folder (IndexedDB), use them directly.
- **Pivot selector** gains "car front / car N / car back" options in addition to the existing numeric offset.
- **Force display** gains a "car position" indicator alongside force values.
- **Multi-rider pivot analysis** (§6.10.3): `TrainConfig` with a `SeatPosition[]` array (per-seat offset + optional heart override + enabled flag). Stats overlay gains a compact multi-seat table; envelope checking (§6.10.1) iterates all enabled seats and groups violations per seat; graph overlay can plot all seats with a "front/middle/back only" simplification toggle.

#### M15 — Node graph view (simplified) **[T2]**

- **Alternative view** to the linear sections list. Toggle in the left panel.
- **Node types** (minimal): Anchor, ForceSection, GeometricSection, CurvedSection, BezierSection, CopyPathSection, BridgeSection, ReverseSection.
- **Connections** are data flow: Anchor → Section → Anchor → Section. Not spatial layout.
- **Right-click context menu** for adding nodes (per KexEdit `docs/reference/node-graph.md`).
- **Drag-to-reorder in list = drag-to-reconnect in graph**: both views represent the same underlying linear/extended-linear data model.

#### M16 — Element library, expanded track styles, T2 ship **[T2]**

- **Element library** (§6.11.1): built-in set (vertical loop, cobra roll, Immelmann, zero-G roll, heartline roll, wave turn, camelback hill, corkscrew) with SVG preview images; "Elements" tab in the left panel with drag-to-insert + save-as-element for user-authored templates; auto-generated PNG previews for custom elements (offscreen Three.js render) stored next to the template in IndexedDB.
- **Expanded track styles** (§6.11.2): 10–12 additional `*Generic` styles beyond FVD++'s 8 (Inverted, Floorless, Wing, Flying, Spinner, Launch, Hyper, Wooden, MineTrain, Family, Suspended, BeyondVertical), data-driven via a style registry; no manufacturer names in identifiers or UI strings.
- Polish: UX review of all M11–M15 additions, fix rough edges.
- Updated DE translation for new features.
- Tutorial series: "Build a shuttle coaster," "Close a circuit with a bridge," "Use the optimizer to perfect a roll," "Drop in a vertical loop with the element library."
- **Ship.**

### Tier 3 — "Modern coaster design tool"

**Ship target:** the tool modern designers actually want. Switch tracks, launch sections, magnetic brakes, overhang geometry. Rigid-body multi-car simulation. Non-exportable to NoLimits (by construction).

#### M17 — Launch + brake sections **[T3]**

- **`LaunchSection`** per §6.8.1: velocity override with prescribed profile. Launch-type presets (LSM/LIM/tire/hydraulic).
- **`BrakeSection`** per §6.8.2: deceleration profile from force curve.
- Force-curve editor in timeline for both.
- **Forward + backward launches**: integrates with signed velocity from T2.
- UI warnings: "projects with launch/brake sections cannot be exported to NL1/NL2."

#### M18 — Switch tracks + full DAG **[T3]**

- **`SwitchSection`** per §6.8.3: multiple outputs, runtime switch state.
- **Full DAG topology**: sections are no longer strictly linear. Integration becomes per-path.
- **Node graph view upgraded**: multi-output sections, runtime switch state controls.
- **Validation**: cycle detection, path-completeness check.

#### M19 — Beyond-vertical, sync points & clearance checking **[T3]**

- **Overhang geometry** per §6.8.4: revised spine placement for beyond-vertical sections.
- **Sync points** per §6.8.5: timing constraints, optimizer integration.
- **Clearance envelope vs imported scenery** (§6.10.5): user-configurable `clearanceLat` / `clearanceNorm` per track; oriented-bounding-box sweep tested against imported mesh assets (M13) every ~0.5 m; "Clearance" color mode on the track mesh; compliance-panel "Clearance violations" section with offending mesh name + intrusion depth. Runs on the worker.

#### M20 — Rigid-body multi-car physics **[T3]**

- **Full rigid-body sim** per §6.3 T3: cars as coupled rigid bodies, constraint solver, inter-car dynamics.
- **Design-forces vs simulated-forces** distinction in UI.
- **Not for export**: sim output is analysis-only.

#### M21 — T3 ship **[T3]**

- Comprehensive documentation of all modern features.
- "Design a Voltron-style launch coaster" tutorial.
- **Ship.**

### Between-tier maintenance

Expect polish PRs, bug fixes, and accessibility improvements between every milestone. Those don't get milestone numbers. Significant user-facing polish work that slots between T1 and T2, or T2 and T3, ships as T1.1 / T2.1 etc.

## 20. Things explicitly out of scope (at every tier)

These are **not** deferred to a later tier — they're out of the plan entirely. If the user base clamors for them, they become candidates for T4+.

- **Cloud save / real-time collaboration.** Files stay local. Projects are single-user.
- **Track import from `.nltrack` (NL1 native format).** The v0.5 FVD++ changelog says this was never given real physics anyway.
- **`.3ds` export.** FVD++ calls it experimental for a reason; `trackmesh.cpp` has 1,500+ LOC of special-case 3DS mesh generation we're not porting.
- **Terrain modeling and scenery.** FVD++ has none, KexEdit has none. Out of scope. Mesh reference assets (T2, §6.8) give you a workaround for this.
- **Automatic coaster support generation.** Passive/imported supports (T1) and manual placement (T3 if ever) only; we don't do the "generate B&M-style structure automatically" thing. It's a visual-design problem, not a physics problem, and our time is better spent elsewhere.
- **Touch-first / mobile editing.** Target desktop. Tablet degraded-mode is OK but not tested, phone is explicitly unsupported (§17).
- **User-customizable keyboard shortcuts.** Ship defaults through all tiers. Customization is a preferences-subsystem addition that should happen once the default set is proven stable.
- **Plugin / scripting API.** Someone will ask. Say no; the alternative is exposing an internal API we don't want to commit to maintaining.
- **Realistic visuals** — cinematic lighting, photo materials, procedural scenery, weather. Out of scope for a design tool; if you want pretty pictures, export to NoLimits 2 and render there.
- **Simulation of ride dispatch operations, throughput, line management.** We design a ride, we don't operate a park.
- **Finite element / structural analysis of the track or supports.** Stress, strain, fatigue, buckling, natural frequencies. This requires a real FEM solver and an element library (beams, shells, connections), neither of which is worth building for this tool's audience. What pro manufacturers get from ANSYS, Nastran, or in-house FEM packages is outside our scope — we check geometric forces, not physical load-bearing.
- **Production drawings, CNC / welding / bending output.** Exporting track geometry to IGES, STEP, or manufacturer-specific CNC formats for actual factory production. This requires tolerance analysis, material specifications, welding annotations. Real coaster manufacturing pipelines use CATIA or SolidWorks for this; we don't replace them.
- **Regulatory certification document generation.** Load case reports, failure-mode analysis, emergency-stop simulation reports, evacuation path verification documents. Software can assist a certified engineer; it cannot replace one. WebFVD's compliance checking (§6.10.1) is a design aid, not a certification pathway.
- **Manufacturer-specific parameterized track libraries.** We ship 8 generic styles (from FVD++). We don't attempt to reproduce B&M's exact rail profile, Mack Stryker dimensions, Vekoma SLC geometry, etc. — these are proprietary to those companies and legally risky to reverse-engineer from public photos.
- **Heart-rate modeling, biomechanical prediction, motion sickness likelihood.** Professional tools can predict subjective ride comfort from trajectory data because their vendors have spent decades correlating measurements to response. We don't have the dataset and won't acquire it; stick to measurable physical quantities.
- **Launch system electrical / thermal / power-grid design.** LSM coil layout, power draw, thermal dissipation, grid integration. Our `LaunchSection` (T3, §6.8.1) specifies a kinematic profile; the electrical engineering to realize it is out of scope.
- **Full terrain / scenery / park-designer system.** Heightmap terrain, painted texture layers, water with reflection/refraction shaders, 3D animated trees with LOD, walkways, fences, buildings. NL2 is a park designer; we're a track design tool. The Mesh reference asset feature (§6.8 T2) covers the minimum case of "I need to see where the track is relative to other geometry."
- **Lua / JavaScript / in-editor scripting API.** NL2's Lua scripting drives much of its community's creativity, but for a browser-based app we decline for three reasons: (1) safely sandboxing user-provided code in a web context is a meaningful engineering project on its own; (2) a scripting API is a commitment to maintain a stable interface indefinitely, competing for design attention with the core tool; (3) what scripting typically enables (custom animations, effects, control-panel logic) is out of our scope as a design tool. Users who need behaviour not expressible in WebFVD's data model should use a separate tool.
- **Block system, multi-train dispatch simulation, station operations.** NL2 simulates how a ride actually runs — multiple trains, block sections, dispatch timing, E-stop behaviour, transfer tables, maintenance modes. This is orthogonal to design: a coaster's physical design can be validated independent of its operating rules. Our playback (§6.3) always shows a single train traversing the circuit.
- **Animated flat-ride library.** Ferris wheels, drop towers, pirate ships, observation towers. We design roller coasters; flat rides are a different category.
- **Cinematic rendering.** Day/night cycle, dynamic weather, HDR, ambient occlusion, sun shafts, bloom, depth-of-field, volumetric fog. Three.js's default renderer gives us adequate visuals for a design tool. Users who want pretty pictures export to NoLimits 2 and render there.
- **Custom material editor, shader authoring, `.nl2mat`-style material files.** Our track styles use fixed PBR materials. Theming is a rendering problem; we stay in design.
- **Package encryption / password protection / DRM.** NL2 Professional offers password-protected packages so commercial designers can send viewable-but-not-editable files to clients. Our files are open JSON; users who need read-only views should export video or screenshots. We will not add encryption, checksums, or any "protection" feature that obscures project structure.
- **Satellite-imagery overlay as ground plane.** Useful for fitting a design to a specific plot of land, but out of scope here; users who need it can import a flat Mesh reference asset (§6.8 T2).

## 20b. Deferred to later tiers (will happen)

Listed to make the "out of scope" list unambiguous — these _are_ planned:

- Multi-car train visualization → T2 (M14).
- Rigid-body train physics → T3 (M20).
- Node graph view → T2 (M15).
- Closed circuits / bridges → T2 (M12).
- Shuttle coasters → T2 (M11).
- Switch tracks → T3 (M18).
- Launch / brake sections → T3 (M17).
- Beyond-vertical geometry → T3 (M19).
- Sync points → T3 (M19).
- Custom train-style JSON + mesh import → T2 (M14, compat with KexEdit train packages).
- **VR / WebXR POV mode → post-T3 (T4 candidate).** Browser WebXR support and the coaster-VR experience both need to improve before this is worth shipping, and it layers cleanly on top of the POV camera built in T1 (§6.3). Revisit once T3 ships.
- **In-viewport section handles → T2 (M7 split).** Drag a section's end point to change length; drag a tangent gizmo to change entry/exit direction; drag a banking wheel to adjust roll. The numerical properties panel (M4) and the 3D handles share the same Zustand commands, so they stay in sync. Requires raycasting against per-section proxy geometry and a gizmo shader pass — do it alongside the viewport polish already scheduled for M7. **Precursor at M7**: click-to-select a section in the 3D view. Raycast against per-section proxy lines (or pick on pointer-over using `sectionIndex` from the worker), then call `store.selectSection(index)`. No drag, just selection — same action the SectionsPanel already exposes.
- **Ribbon-vs-full-model toggle → M7 (viewport polish).** Today's viewport draws the track as a three-line ribbon (centreline + two rails + cross-ties). M7 adds real track-style-driven profile geometry (rails + spine + ties per FVD++'s TrackStyle values). Keep the ribbon as a debug/overview mode the user can switch back to — fast to render for long tracks, easy to read banking, and the only representation that works when the style dropdown is blank.
- **Heart-line vs rail-line ribbon → M7.** The ribbon currently renders around the integrated centre (heart) line. Riders feel motion at the rail line (offset by `track.heart` along the normal), and some users want to see where their feet sit rather than where their head does. A toggle (Viewport settings) flips the ribbon to draw `positions + norm × heart` instead of `positions ± lat × railHalfWidth` so both views are available.
- **Sky + environment textures → M7.** FVD++ ships panoramic sky images and ground textures in its resources tree (GPL-3.0, compatible with our AGPL-3.0 output). Three.js has first-class support: equirectangular sky maps feed `scene.background` + `scene.environment` via `THREE.EquirectangularReflectionMapping` / `PMREMGenerator`; ground textures go on the `GridHelper` replacement. Ship a small bundled set at M7 plus a "drop your own" file picker, attribution in `NOTICE`. The `texturePath` field we already round-trip through `.webfvd.json` and `.fvd` points at the ground texture — that wiring is already in place.
- **Roll offset bake-on-export → M9.** The integrator applies `rollOffset = prevRoll − rollFunc(0)` inside every section so the rider's roll stays continuous even if a user edited a section's banking without syncing with the previous section's end. FVD++ does not — it evaluates `rollFunc(0)` literally. When the `.fvd` writer lands at M9, it must bake the accumulated offset into each section's `rollFunc.subfuncs[0].startValue` so FVD++ integrates the same smooth curve we do. Until M9 exists, no risk.
- **Perspective ↔ Orthographic camera toggle → M7.** Today the viewport
  always uses a `PerspectiveCamera`. A toggle in the viewport toolbar
  flips to an `OrthographicCamera` sharing the same `target` and
  `position` direction, with zoom sized so the visible area matches the
  perspective frustum at the target plane. OrbitControls works with both
  camera types, so we can reuse the existing pan/zoom/rotate bindings.
  POV stays perspective (first-person in ortho is confusing). Useful
  for blueprint-style side/top views. Preserve the ViewCube behaviour:
  clicking a face should snap to the same direction under both projections.
- **Draggable 3D handles on sections → M7 (Bezier first).** The biggest
  UX win for Bezier composition is dragging the control points in the 3D
  view instead of editing four numbers in the properties panel. Use
  Three's `TransformControls` attached to a small sphere mesh at each
  handle's world position; on drag, update the store with
  `patch({ handle: { startPos: [x, y, z] } })` so the integrator picks it
  up on the next recompute (≤100 ms). Sockets for other section types:
  Anchor (position + yaw), Straight (length endpoint), Curved (length +
  axis angle). Picking priority: TransformControls gizmo > ViewCube >
  rail raycast. Blocked by a pointer-priority layer we don't have yet —
  build it as part of this slice.
- **ViewCube / navigation gizmo → M7.** Today a world-axes `AxesHelper` at the origin gives R/G/B directional cues (spec §6.4 "Fly mode / ViewCube fallback" mentions a proper cube). Build a Fusion-360-style ViewCube rendered by a small second scene/camera in the top-right corner:
  - **6 face clicks** snap to orthographic Top / Bottom / Front / Back / Left / Right.
  - **12 edge clicks** snap to a 45° isometric between two faces.
  - **8 corner clicks** snap to a 45°/35° trimetric view (classic "three-quarters" camera).
  - **4 rotation arrows** around the currently-facing face rotate the main camera 90° in-plane (clockwise / counter-clockwise / up-axis-flip pair). Arrows only show when a face is frontal; they hide on oblique views.
  - **"Home" corner** (top-right of the cube) returns the main camera to the default three-quarters view — same action as the Reset button.
  - All transitions animate (≈400 ms ease-in-out) so the user can track where the camera went.
- **Non-cascading section edits → T2 (design exploration).** Today the integrator walks sections sequentially, so editing section N's internals shifts every node from N onwards in space. Three candidate mechanisms:
  1. **Pinned end pose**: per-section flag; editing internals runs a solver on whichever parameter is "free" to hold the end pose fixed. Cheap on Straight/Curved (1-D root-find on length or rate), doable on Bezier (2-D on tangent lengths), painful on Forced/Geometric (root-find on the function profile).
  2. **Auto-bridge after edit**: accept the cascade, then append or retune a closure-style Bezier between N and N+1 so downstream stays in place. Reuses `closeTrack` math; cost is a visible extra "bridge" section.
  3. **Independent-pose sections**: per-section flag stores the section's desired absolute start pose; the integrator implicitly inserts a bridge from wherever the previous section actually ended. Most CAD-like, largest architectural change.
     Ship order: (2) first because it's zero-solver and reuses existing code; add (1) as opt-in per section; (3) stays a parked idea.
- **Responsive / portrait layout → M8 (preferences).** The 3-column desktop grid (sections | viewport + graphs | properties) doesn't fold nicely on phones or narrow tablets in portrait. The M8 preferences work ships a breakpoint-driven reshape: below ~900 px wide, collapse the left and right rails into togglable drawers on a hamburger, stack the viewport above the graphs, and swap the header's project-name + language-switcher row to a second line. Media-query driven; no JS resize observer needed for the layout itself.
- **Compact menu / command palette → M8 (preferences).** The current top-bar menu spells out every File + Track action as its own button and eats half the header width. At M8, collapse rarely-used items (Open, Save As, Load Demo, Close Track) under a single `…` overflow menu on narrow widths, and add a Cmd/Ctrl+K command palette that supersedes the menu for keyboard users. **Partially landed at M4** — the narrow-width overflow is in; Cmd-K palette still deferred.
- **NL1 `.nlelem` + NL2 exporters / NL2 CSV import → post-T1.** For T1 we commit to the FVD++ `.fvd` binary (§8.2) as the one export target that matters — it's the native format of the upstream tool, and round-trip parity through it validates every integrator. NoLimits 1 / NoLimits 2 exports (§8.3/§8.4) and NL2 CSV import (§8.5) are popular but require access to real NL2 to verify byte-exact output, and the project should stabilise on its own format first. Revisit after the public M10 ship; order of priority when we get there is NL2 binary > NL1 `.nlelem` > NL2 CSV import.
- **Curved-section alternate input modes → (partially landed).** FVD++ exposes Curved sections in two user-facing forms besides our current "rate per meter": (1) **total angle over section** — user types target pitch and yaw angles and the section length, rates fall out as `angle / length`; and (2) **axis-angle** — a single rotation around a user-chosen axis, projected onto pitch + yaw rates. Both are UI conveniences; the stored section stays `pitchRate` / `yawRate` / `length` so recompute and round-trip don't care how the numbers were typed. **Landed as the Curved properties panel's input-mode dropdown at M4.5.**

## 21. Pitfalls to avoid

- **Don't port `qcustomplot`.** It's 25k lines of Qt charting. uPlot covers speed/force graphs; custom SVG covers the timeline. Together, maybe 1200 lines.
- **Don't port the Qt undo system blindly.** It's entangled with Qt's signal/slot model. The _pattern_ transfers; the code doesn't.
- **Don't try to make the physics deterministic across float32/float64.** The C++ uses float32 (glm's default). You'll use float64 in JS. Expected ULP-level differences are fine; the test tolerances account for it.
- **Don't block the main thread on recompute, ever.** The moment you do, a ~30-second track with force sections will jank the UI for hundreds of ms.
- **Don't "modernize" the physics.** No RK4, no adaptive stepsize. FVD++ uses fixed 1000 Hz Euler for a reason: it's deterministic, and NL2 expects this sample rate for export compatibility.
- **Don't silently "fix" what look like bugs in the source.** The `0.9 * heartLine` in energy calculation is intentional. The off-by-one at section boundaries is intentional. If something looks wrong, leave a `// NOTE: matches FVD++ 0.79 behavior` comment and move on.
- **Don't hand-roll a table component.** Use TanStack Table. Virtualization is non-trivial to get right.
- **Don't show a loading spinner for recompute.** At our target perf it's < 100 ms. A spinner that flashes for 80 ms looks like jank. Only show progress UI if something takes > 500 ms (e.g. initial load of a large project).
- **Don't hard-code strings.** Not for placeholders, not for "TBD", not for error messages. Every string goes through `t()`. This is easy at the start and a nightmare to retrofit.
- **Don't assume velocity is positive.** FVD++ does and it bakes the assumption deep: `sqrt(2E)` for recovery, `break` loops on near-zero velocity, unsigned integration math. Our §6.6 extension is not a 10-line change. When porting any section integrator, ask: "does this handle a train entering at v < 0?" If no, fix it while the surrounding context is fresh.
- **Don't confuse spatial position and chronological position.** For forward-only coasters they're identical; for shuttles they diverge. The playhead is chronological. The node stream is chronological. Graph x-axes are chronological (unless the user explicitly picks distance). Spatial position is derived from the chronological node stream and can be non-monotonic.

## 22. Getting started checklist for Claude Code

Before writing any TypeScript:

1. Clone `altlenny/openFVD` into `reference/openfvd/` (git-ignored). Everything points at file paths there. This is the **ground truth for physics and file format**.
2. Clone `IndividualKex/KexEdit` into `reference/kexedit/` (git-ignored). This is the **reference for UI and advanced features**. Read their `docs/` directory thoroughly — `docs/reference/node-graph.md`, `docs/reference/timeline.md`, `docs/reference/game-view.md`, `docs/user-guide/*.md`. Don't translate the C# — study the behavior, design from scratch in TypeScript.
3. Read the openFVD source, in order: `core/mnode.h`, `core/section.h`, `core/subfunction.h`, `core/function.h`, `core/track.h`, then `core/secforced.cpp` from the top until the first integration loop (around line 110). The integration loop at lines 110–135 is the whole product in 25 lines.
4. Set up the M0 scaffold.
5. Write the `MNode` SoA and run a null integration (identity step) to prove the worker/Comlink boundary is sound.
6. Begin M1.

### Rules of engagement across tiers

- **Don't skip ahead.** Work milestones in order, within the current tier. If a milestone feels small, ship it and start the next one rather than bundling.
- **Don't slip between tiers.** Every T1 milestone must be done before starting any T2 work. If you find yourself reaching for a T2 feature while working on T1, stop and ask "can I defer this?" — the answer is almost always yes.
- **Each milestone is a PR.** Not a branch accumulating work for weeks. Keep PRs scoped and review-able. Large milestones (M7, M11, M20) may split into sub-PRs by feature.
- **Each tier ends with a ship.** T1 ships publicly at the end of M10. T2 at M16. T3 at M21. "Ship" means real users can download, install, and use it. Not "code review approved."
- **Always keep `main` green and deployable.** Feature flags behind unreleased work if needed.
- **Tests first for the physics core.** Every integrator PR includes its golden-file tests. No "we'll test later."
- **UI correctness comes from prototype review, not tests.** Invest less in UI test automation; invest more in running the app and trying things.

### When you're stuck

- **On physics:** return to the C++. It has 16 years of edge cases baked in. Match its output first, understand why later if it matters.
- **On UI:** open KexEdit, try to reproduce the flow. Or open Blender / Fusion / Figma and see how they solve a similar problem.
- **On scope:** ask "is this T1? Should I ship without it?" If the answer is "yes" + "maybe," ship without it.

Do not batch multiple milestones into one PR. Each milestone is a reviewable unit.
