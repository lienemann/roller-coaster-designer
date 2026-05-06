<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# FVD++ 0.77 / 0.79 `.fvd` Binary File Format

Byte-level reference for the FVD++ project-file format, derived by reading
the C++ save/load pairs in `reference/openfvd/core/` and `reference/openfvd/ui/`.
This document is the source of truth for our importer/exporter. Every field
is cross-referenced to the C++ line that reads or writes it.

Target version: the format self-identifies as `v0.77` but ships inside FVD++
0.79 releases. An earlier `v0.30` variant is still readable via the
`legacyLoad*` paths (see §8).

> **Reading conventions**
>
> - All offsets in tables below are _relative to the start of the record_,
>   because every record is variable-size.
> - `u32`, `i32`, `f32` = 32-bit unsigned/signed int / IEEE-754 binary32.
> - `u8 bool` = one byte; `0x00` is false, anything else is true.
> - `tag` = a 3- or 4-byte ASCII string written directly to the stream
>   (no length prefix, no terminator).
> - `lstr` = 32-bit length prefix followed by that many raw bytes
>   (no terminator, no encoding declared — treat as UTF-8 via
>   `QString::fromStdString`/`toStdString`).
> - `vec3` = three `f32`s in the logical order x, y, z. See §2 for the
>   on-disk byte pattern (two flavours coexist).

---

## 1. Project file structure (top level)

Source: `reference/openfvd/ui/projectwidget.cpp:358–461`.

```
+-----------------------------+
| "FVD"          (3 bytes)    |  magic
| "v0.77"        (5 bytes)    |  version tag (ASCII)
| texPathLen     (i32)        |  length of ground-texture path
| texPath        (N bytes)    |  relative or absolute path to PNG
| track[0]                    |  (each starts with "TRC")
| track[1]                    |
| ...                         |
| "EOP"          (3 bytes)    |  end-of-project marker
+-----------------------------+
```

- **Magic**: the three literal bytes `F`, `V`, `D` (0x46 0x56 0x44). Written
  unterminated via `file << "FVD"` (projectwidget.cpp:360).
- **Version tag**: five ASCII bytes. Two values are accepted on load
  (projectwidget.cpp:386–392):
  - `"v0.77"` — current format (`legacy = 0`)
  - `"v0.30"` — old format (`legacy = 1`); see §8.
  - Anything else triggers "Error: Unsupported File Version!".
- **Tracks are not counted.** The loader reads `"TRC"` or `"EOP"` in a loop
  (projectwidget.cpp:407–436); a file containing zero tracks is legal but
  results in the `"EOP"` immediately following `texPath`.
- No checksum, no trailing padding, no index, no compression. The file ends
  at `"EOP"`; bytes after it are silently ignored.

### 1.1 Multi-track

Yes — the project can hold N tracks. They are serialized in order, each
beginning with the 3-byte tag `"TRC"` and ending with the 3-byte tag `"EOT"`
(see §3). There is no count field; termination is by the `"EOP"` sentinel
after the last track.

---

## 2. Primitive encoding

Source: `reference/openfvd/core/exportfuncs.cpp:24–186`.

### 2.1 Helpers

| Helper       | Signature                                | Behavior                                                                  |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------- |
| `writeBytes` | `(file, const char* data, size_t len)`   | Writes `data[len-1], data[len-2], …, data[0]` — the buffer is **reversed byte-by-byte** before being emitted. |
| `writeNulls` | `(file, size_t len)`                     | Writes `len` zero bytes.                                                  |
| `readBytes`  | `(file, void* ptr, size_t len)`          | Reads `len` bytes into `ptr[len-1], ptr[len-2], …, ptr[0]` — mirror of `writeBytes`. |
| `readFloat`  | `(file) -> float`                        | Reads 4 bytes into `union { char c[4]; float f; }` as `c[3], c[2], c[1], c[0]`. |
| `readInt`    | `(file) -> int`                          | Same as `readFloat`, interpreted as `int32`.                              |
| `readBool`   | `(file) -> bool`                         | Reads 1 byte; returns `byte != 0`.                                        |
| `readString` | `(file, size_t len) -> std::string`      | Reads `len` bytes unmodified. No reversal, no null terminator.            |
| `readVec3`   | `(file) -> glm::vec3`                    | Returns `vec3(readFloat(), readFloat(), readFloat())` — three back-to-back floats. |
| `readNulls`  | `(file, size_t len) -> bool`             | Consumes `len` bytes (content ignored — the commented `if(c) return false;` in exportfuncs.cpp:137 is disabled). |

### 2.2 Endianness (the important part)

FVD++ was built and ships only on little-endian hosts (x86/x86_64 Windows
and Linux). On such a host:

- A `float` or `int32` that is passed to `writeBytes(ptr, 4)` is stored in
  memory as `b0 b1 b2 b3` (little-endian) and written to disk as `b3 b2 b1 b0`.
  **On disk, 4-byte primitives are big-endian.**
- `readFloat`/`readInt` reverse the same way and therefore round-trip.

**To read `.fvd` files produced by FVD++: treat all `i32`, `u32`, `f32` fields
as big-endian.** (Little-endian interpretation yields nonsense.)

### 2.3 Endianness traps — multi-byte blobs

Several call sites pass `sizeof(T)` where `T` is _larger_ than 4 bytes.
`writeBytes` reverses the _entire_ buffer, not each 4-byte word inside it.
The readers match, so FVD++ round-trips, but anyone else touching these
fields must match the whole-buffer reversal.

| Call site                                          | Length reversed as one unit | Notes |
| -------------------------------------------------- | --------------------------- | ----- |
| `track.cpp:978` `3*sizeof(QColor)`                 | 48 bytes                    | 3 × 16-byte `QColor`s reversed as one 48-byte blob. See §3.1. |
| `track.cpp:981` `sizeof(glm::vec3)` (startPos)     | 12 bytes                    | A `vec3` stored as `x,y,z` in memory is written `z.b3 z.b2 z.b1 z.b0 y.b3 y.b2 y.b1 y.b0 x.b3 x.b2 x.b1 x.b0`. |
| `secbezier.cpp:294–296` `sizeof(glm::vec3)`        | 12 bytes                    | Same treatment for `P1`, `Kp1`, `Kp2`. |
| `secbezier.cpp:306` `sizeof(glm::vec3)`            | 12 bytes                    | `supList[i]`. |

The `readVec3` helper (three individual `readFloat`s) is _not_ the inverse
of `writeBytes(ptr, 12)` under a strict reading — it only works because GCC
evaluates the three `readFloat` arguments right-to-left, so the stored order
`z, y, x` lines up with the `vec3(x, y, z)` constructor when arguments are
evaluated right-to-left. **This is undefined behavior in C++ — our reader
must explicitly swap the three floats' order when reading a `vec3` that was
written via `writeBytes(ptr, 12)` (whole-buffer reversal) so that the
on-disk `z, y, x` order becomes the in-memory `x, y, z`.**

Conversely, `secnlcsv.cpp:140–150` and `section.cpp:112–114/121–123/128–130`
write each vec3 as three _separate_ `writeBytes(..., 4)` calls, one per
component, in `x, y, z` order. Those come out as three big-endian `f32`s in
`x, y, z` order and match `readVec3` trivially. **The two conventions
coexist in the file.** Annotate each `vec3` field below with its flavor.

### 2.4 No padding, no alignment

Records are densely packed. There is no alignment, no padding, no length
prefix at the record level (only at the string and collection level).

---

## 3. Track record

Source: `reference/openfvd/core/track.cpp:968–1141`.

```
+-----------------------------+
| "TRC"          (3 bytes)    |  track marker
| nameLen        (i32 BE)     |
| name           (N bytes)    |
| trackColors    (48 bytes)   |  3 × QColor, whole-blob reversed
| startPos       (12 bytes)   |  glm::vec3 – whole-blob reversed
| fRoll          (f32 BE)     |  anchor roll,     degrees
| startPitch     (f32 BE)     |  anchor pitch,    degrees
| startYaw       (f32 BE)     |  anchor yaw,      degrees
| fVel           (f32 BE)     |  anchor velocity, m/s
| forceNormal    (f32 BE)     |  anchor gN,       g-units
| forceLateral   (f32 BE)     |  anchor gL,       g-units
| fHeart         (f32 BE)     |  heartline,       m
| fFriction      (f32 BE)     |  rolling friction coefficient (dimensionless)
| fResistance    (f32 BE)     |  air resistance,  1/m
| drawTrack      (u8 bool)    |
| drawHeartline  (i32 BE)     |  mode index (0 = off, see code)
| style          (i32 BE)     |  trackStyle enum — see §7.3
| isWireframe    (u8 bool)    |  render mode flag
| povPos.x       (f32 BE)     |  "POV" pan x, m
| povPos.y       (f32 BE)     |  "POV" pan y, m
| sectionCount   (i32 BE)     |
| section[0..]                |  see §4
| smootherCount  (i32 BE)     |
| smoother[0..]               |  see §9
| "EOT"          (3 bytes)    |
+-----------------------------+
```

| Offset (relative) | Size | Type     | Field           | Notes / C++                                          |
| ----------------- | ---- | -------- | --------------- | ---------------------------------------------------- |
| 0                 | 3    | tag      | "TRC"           | `track.cpp:970`                                      |
| 3                 | 4    | i32      | nameLen         | `track.cpp:975`                                      |
| 7                 | N    | bytes    | name            | UTF-8; `track.cpp:976`                               |
| 7+N               | 48   | blob     | trackColors     | `track.cpp:978`; see §3.1                            |
| 55+N              | 12   | vec3\*   | startPos (m)    | `track.cpp:981`; whole-blob reversed                 |
| 67+N              | 4    | f32      | anchor.fRoll    | deg; `track.cpp:982`                                 |
| 71+N              | 4    | f32      | startPitch      | deg; `track.cpp:983`                                 |
| 75+N              | 4    | f32      | startYaw        | deg; `track.cpp:984`                                 |
| 79+N              | 4    | f32      | anchor.fVel     | m/s; `track.cpp:986`                                 |
| 83+N              | 4    | f32      | anchor.forceNormal  | g; `track.cpp:988`                               |
| 87+N              | 4    | f32      | anchor.forceLateral | g; `track.cpp:989`                               |
| 91+N              | 4    | f32      | fHeart          | m; `track.cpp:991`                                   |
| 95+N              | 4    | f32      | fFriction       | dimensionless; `track.cpp:992`                       |
| 99+N              | 4    | f32      | fResistance     | 1/m; `track.cpp:993`                                 |
| 103+N             | 1    | u8 bool  | drawTrack       | `track.cpp:995`                                      |
| 104+N             | 4    | i32      | drawHeartline   | `track.cpp:996`                                      |
| 108+N             | 4    | i32      | style           | trackStyle enum; `track.cpp:997`; see §7.3           |
| 112+N             | 1    | u8 bool  | isWireframe     | mesh render flag; `track.cpp:998`                    |
| 113+N             | 4    | f32      | povPos.x        | `track.cpp:1000`                                     |
| 117+N             | 4    | f32      | povPos.y        | `track.cpp:1001`                                     |
| 121+N             | 4    | i32      | sectionCount    | direct count; `track.cpp:1004–1005`                  |
| 125+N             | var  | section* | sections        | see §4. Order matters; sections are chained.         |
| ...               | 4    | i32      | smootherCount   | direct count; `track.cpp:1013–1014`                  |
| ...               | var  | smoother*| smoothers       | see §9                                               |
| ...               | 3    | tag      | "EOT"           | `track.cpp:1020`                                     |

Units confirmed by cross-referencing: `fHeart` meters
(`track.cpp:50` `F_G*fPosHearty(0.9*heartLine)`), `fRoll`/`startPitch`/`startYaw`
degrees (see `mnode::changePitch` and all uses), `fVel` m/s.

### 3.1 trackColors blob (48 bytes)

Three `QColor` instances from Qt 4/5 are memcpy'd. `sizeof(QColor)` is
**16 bytes** on the reference build (enum `Spec` + 5 × `ushort` RGBA union
+ 2 bytes of padding). The whole 48-byte region is bit-for-bit reversed by
`writeBytes`, so byte 0 on disk equals byte 47 in memory and vice versa.

> **Recommendation:** Treat these 48 bytes as opaque when round-tripping. If
> emitting from scratch, keep three default-initialized `QColor`s: in Qt's
> native layout these are `{ Spec::Invalid=0, alpha=0, red=0, green=0, blue=0,
> pad=0, pad=0 }` — 16 zero bytes each. The FVD++ track defaults are RGB
> (20,20,130), (255,51,51), (51,255,51) (trackhandler.cpp:52–54) but these
> are display-only and the loader tolerates invalid colors (Qt coerces to black).

### 3.2 Legacy (`v0.30`) track

Source: `track.cpp:1143–1259`. **The field order is identical to `v0.77`.**
The only difference is that every nested `func` uses `legacyLoadFunction`
(see §5) and every nested section uses `legacyLoadSection` (see §4).

---

## 4. Section records

Each section begins with a 3-byte tag. The tag determines which `loadSection`
is dispatched (`track.cpp:1065–1118`).

| Tag   | Section class | C++ file    | saveSection line |
| ----- | ------------- | ----------- | ---------------- |
| `STR` | straight      | `secstraight.cpp` | 136–150    |
| `CUR` | curved        | `seccurved.cpp`   | 196–215    |
| `FRC` | forced        | `secforced.cpp`   | 342–360    |
| `GEO` | geometric     | `secgeometric.cpp` | 402–420   |
| `BEZ` | bezier        | `secbezier.cpp`   | 281–308    |
| `CSV` | nolimitscsv   | `secnlcsv.cpp`    | 131–152    |

> **Note on names.** In the `secType` enum the type is called `nolimitscsv`,
> but the on-disk tag is `"CSV"` (not `"NLC"`). `section.h:36–45` defines
> the enum; `secnlcsv.cpp:135` emits `"CSV"`.

### 4.1 Straight — `"STR"`

`secstraight.cpp:136–150`, read at `:152–163`.

| Offset | Size | Type    | Field        | Notes                                                  |
| ------ | ---- | ------- | ------------ | ------------------------------------------------------ |
| 0      | 3    | tag     | "STR"        |                                                        |
| 3      | 1    | u8 bool | bSpeed       | false = "hold velocity", true = "let physics take over"|
| 4      | 4    | i32     | nameLen      |                                                        |
| 8      | N    | bytes   | name         | UTF-8 section name                                     |
| 8+N    | 4    | f32     | fVel         | m/s — target velocity when `bSpeed == false`           |
| 12+N   | 4    | f32     | fHLength     | m — horizontal (heart-line) length                     |
| 16+N   | var  | func    | rollFunc     | see §5; tag `"FUNC"` included                          |

### 4.2 Curved — `"CUR"`

`seccurved.cpp:196–215`, read at `:217–233`.

| Offset | Size | Type    | Field        | Notes                                                  |
| ------ | ---- | ------- | ------------ | ------------------------------------------------------ |
| 0      | 3    | tag     | "CUR"        |                                                        |
| 3      | 1    | u8 bool | bSpeed       |                                                        |
| 4      | 4    | i32     | nameLen      |                                                        |
| 8      | N    | bytes   | name         |                                                        |
| 8+N    | 4    | f32     | fVel         | m/s                                                    |
| 12+N   | 4    | f32     | fAngle       | total turn, degrees                                    |
| 16+N   | 4    | f32     | fRadius      | arc radius, m                                          |
| 20+N   | 4    | f32     | fDirection   | direction angle, degrees (tilt axis)                   |
| 24+N   | 4    | f32     | fLeadIn      | lead-in length, **degrees of ridden angle**            |
| 28+N   | 4    | f32     | fLeadOut     | lead-out length, **degrees of ridden angle**           |
| 32+N   | 1    | u8 bool | bOrientation | `true` = QUATERNION, `false` = EULER (section.h:28–29) |
| 33+N   | var  | func    | rollFunc     |                                                        |

> `fLeadIn` and `fLeadOut` are stored in **degrees of ridden angle**, not
> meters. See `seccurved.cpp:86–88,94–96` — the smoothstep ramps over
> `1.997/F_HZ * fVel/deltaAngle * fLeadIn` metres of arc, where `fLeadIn`
> itself is in degrees.

### 4.3 Forced — `"FRC"`

`secforced.cpp:342–360`, read at `:362–377`.

| Offset | Size | Type    | Field        | Notes                                                  |
| ------ | ---- | ------- | ------------ | ------------------------------------------------------ |
| 0      | 3    | tag     | "FRC"        |                                                        |
| 3      | 1    | u8 bool | bSpeed       |                                                        |
| 4      | 4    | i32     | nameLen      |                                                        |
| 8      | N    | bytes   | name         |                                                        |
| 8+N    | 4    | f32     | fVel         | m/s                                                    |
| 12+N   | 4    | i32     | iTime        | duration in 1/1000 s (integer milliseconds)            |
| 16+N   | 1    | u8 bool | bOrientation | EULER / QUATERNION                                     |
| 17+N   | 1    | u8 bool | bArgument    | `false` = TIME, `true` = DISTANCE (section.h:31–32)    |
| 18+N   | var  | func    | rollFunc     |                                                        |
| ...    | var  | func    | normForce    | g-units                                                |
| ...    | var  | func    | latForce     | g-units                                                |

### 4.4 Geometric — `"GEO"`

`secgeometric.cpp:402–420`, read at `:422–437`. **Identical on-disk layout
to `FRC`** — only the tag differs. Fields `bSpeed, nameLen, name, fVel,
iTime, bOrientation, bArgument, rollFunc, normForce, latForce` in that
order.

`normForce` is pitch rate and `latForce` is yaw rate (deg/s or deg/m) — in
a geometric section the force functions are semantically reinterpreted as
angle rates per the funcType enum (§7.4).

### 4.5 Bezier — `"BEZ"`

`secbezier.cpp:281–308`, read at `:310–333`.

| Offset | Size | Type      | Field         | Notes                                                       |
| ------ | ---- | --------- | ------------- | ----------------------------------------------------------- |
| 0      | 3    | tag       | "BEZ"         |                                                             |
| 3      | 4    | i32       | nameLen       | **No `bSpeed`, no `fVel`.** The stream jumps straight to the name. |
| 7      | N    | bytes     | name          |                                                             |
| 7+N    | 4    | i32       | bezcount      |                                                             |
| 11+N   | var  | bezier[]  | bezList       | each element 40 bytes (see below)                           |
| …      | 4    | i32       | supcount      |                                                             |
| …      | var  | vec3[]    | supList       | each 12 bytes, whole-blob reversed                          |

#### 4.5.1 `bezier_t` on-disk entry (40 bytes)

`secbezier.cpp:294–299`. Written as six separate `writeBytes` calls, so
per-field reversal rules:

| Offset (rel) | Size | Type    | Field     | Notes                                        |
| ------------ | ---- | ------- | --------- | -------------------------------------------- |
| 0            | 12   | vec3\*  | P1        | 12-byte whole-blob reversed (z,y,x on disk)  |
| 12           | 12   | vec3\*  | Kp1       | 12-byte whole-blob reversed                  |
| 24           | 12   | vec3\*  | Kp2       | 12-byte whole-blob reversed                  |
| 36           | 1    | u8 bool | contRoll  |                                              |
| 37           | 1    | u8 bool | relRoll   |                                              |
| 38           | 4    | f32     | roll      | radians (see section.cpp:143 for writer)     |

`supList` entries are 12-byte whole-blob-reversed `glm::vec3`s.

> The in-memory `bezier_t` struct has many more fields (`equalDist`, `ptf`,
> `fvdRoll`, `length`, `numNodes`, `fVel` — mnode.h:30–44). **None of these
> are serialized.** They are recomputed on load.

### 4.6 NoLimits CSV — `"CSV"`

`secnlcsv.cpp:131–152`, read at `:154–168`.

| Offset | Size | Type       | Field      | Notes                                     |
| ------ | ---- | ---------- | ---------- | ----------------------------------------- |
| 0      | 3    | tag        | "CSV"      |                                           |
| 3      | 4    | i32        | size       | number of csvNodes                        |
| 7      | size×36 | csvNode[] | csvNodes  | each entry 36 bytes                       |

#### 4.6.1 csvNode (36 bytes)

Written as nine separate `writeBytes(..., 4)` calls (secnlcsv.cpp:140–150).
Unlike bezier vec3s, these are three f32s per vec3 in `x, y, z` order — the
simple case.

| Offset (rel) | Size | Type | Field  | Notes     |
| ------------ | ---- | ---- | ------ | --------- |
| 0            | 4    | f32  | vPos.x | m         |
| 4            | 4    | f32  | vPos.y | m         |
| 8            | 4    | f32  | vPos.z | m         |
| 12           | 4    | f32  | vDir.x | unit vec  |
| 16           | 4    | f32  | vDir.y |           |
| 20           | 4    | f32  | vDir.z |           |
| 24           | 4    | f32  | vLat.x | unit vec  |
| 28           | 4    | f32  | vLat.y |           |
| 32           | 4    | f32  | vLat.z |           |

No name, no bSpeed, no fVel — CSV sections carry only raw spline nodes.

---

## 5. Func (list of SubFuncs)

Source: `function.cpp:151–187`.

```
+-----------------------------+
| "FUNC"         (4 bytes)    |  tag (four bytes, not three)
| subfuncCount   (i32 BE)     |
| subfunc[0]                  |
| subfunc[1]                  |
| ...                         |
+-----------------------------+
```

| Offset | Size | Type    | Field         |
| ------ | ---- | ------- | ------------- |
| 0      | 4    | tag     | "FUNC"        |
| 4      | 4    | i32     | subfuncCount  |
| 8      | var  | subfunc[] | entries     |

Loader behavior (function.cpp:167–172): the first subfunc is loaded into
the pre-existing `funcList[0]` (a Func is never empty — the parent section
creates it with a single default subfunc); each subsequent subfunc is
created via `appendSubFunction(1, i-1)` _before_ being loaded.

> **No funcType field is serialized.** A func's purpose (roll / normal /
> lateral / pitch / yaw) is implied by its ordinal position in the
> enclosing section. In a `FRC`/`GEO` section the three funcs are always
> `rollFunc`, then `normForce`, then `latForce`, in that order.

---

## 6. SubFunc (9 fields, 33 bytes)

Source: `subfunction.cpp:303–327`, read at `:329–340`. Fixed size 33 bytes,
no tag.

| Offset (rel) | Size | Type    | Field       | Notes                                                   |
| ------------ | ---- | ------- | ----------- | ------------------------------------------------------- |
| 0            | 4    | i32     | degree      | eDegree enum; see §7.5                                  |
| 4            | 4    | f32     | minArgument | **absolute lower bound** (time in s _or_ distance in m, depending on the owning section's `bArgument`) |
| 8            | 4    | f32     | maxArgument | **absolute upper bound** — the subfunc spans `[min, max]` |
| 12           | 4    | f32     | startValue  | y-value at `x = minArgument`, units vary by function type |
| 16           | 4    | f32     | arg1        | shape parameter; per-degree meaning (see §7.5)          |
| 20           | 4    | f32     | symArg      | Δy — the change in value over the span; `endValue = startValue + symArg` (subfunction.cpp:177) |
| 24           | 4    | f32     | centerArg   | horizontal asymmetry warp `[-1..1]` (subfunction.cpp:`applyCenter`) |
| 28           | 4    | f32     | tensionArg  | horizontal tension warp; 0 = none, ±∞ = step            |
| 32           | 1    | u8 bool | locked      | UI flag — locks the subfunc's end to the next section's start |

### 6.1 Length is exclusive — measured as `max − min`

The SubFunc record stores absolute `minArgument` and `maxArgument`; its
"length" is the arithmetic difference. The stringstream loader at
`subfunction.cpp:360` calls `parent->changeLength(maxArgument-minArgument, …)`
to propagate this into the in-memory length representation. fstream load
does not — it relies on the section's own loader to reconstruct lengths
(e.g. from `iTime` for `FRC`/`GEO`, or from `fHLength` / `fAngle` for
`STR`/`CUR`).

> **Bug / inconsistency.** The `stringstream` variant `subfunc::loadSubFunc`
> (subfunction.cpp:355–367) calls `parent->changeLength(...)` but the
> `fstream` variant (subfunction.cpp:329–340) does not. This means the
> in-memory length state after loading a file is not quite the same as
> after loading from an undo snapshot. Disk files still load correctly
> because the enclosing section re-derives length.

### 6.2 Freeform data not serialized (real bug)

`eDegree::freeform = 8` and `eDegree::tozero = 7` both carry extra in-memory
state (`pointList`, `valueList`, and `tozero`'s derived `symArg`). **None
of these are saved or loaded.** A saved freeform subfunc has `degree=8` and
the 9 scalars; on load, `pointList`/`valueList` are empty. FVD++ crashes
or returns `-1` when evaluating (subfunction.cpp:239).

> We should not emit `degree == 8` (freeform) in files we author and should
> refuse / warn on files that contain one.

### 6.3 Reader ignores degree when parsing

The fields are the same regardless of degree. `arg1`/`centerArg`/`tensionArg`/
`symArg` are always read in the same slot; their _meaning_ is degree-dependent.

---

## 7. Enums (on-disk numeric values)

### 7.1 secType — `section.h:36–45`

Declared but **not directly serialized**. The loader dispatches on the
3-byte tag instead. Numeric values still matter inside in-memory data
structures and are listed for reference:

| Value | Symbol          | Tag on disk |
| ----- | --------------- | ----------- |
| 0     | `anchor`        | — (not saved as a section) |
| 1     | `straight`      | `"STR"`     |
| 2     | `curved`        | `"CUR"`     |
| 3     | `forced`        | `"FRC"`     |
| 4     | `geometric`     | `"GEO"`     |
| 5     | `bezier`        | `"BEZ"`     |
| 6     | `nolimitscsv`   | `"CSV"`     |

### 7.2 bOrientation / bArgument — `section.h:28–32`

Both are **`bool`, 1 byte**. Macros define:

| Macro        | Value | Meaning              |
| ------------ | ----- | -------------------- |
| `EULER`      | true  | Euler orientation    |
| `QUATERNION` | false | Quaternion orientation |
| `TIME`       | false | argument is time (s) |
| `DISTANCE`   | true  | argument is distance (m) |

Round-trip: `bOrientation` is written from `bool` and read with `readBool`;
same for `bArgument` (`secforced.cpp:372–373`, etc.).

### 7.3 trackStyle — `track.h:41–50`, serialized as `i32`

| Value | Symbol        | Cross-section gauge |
| ----- | ------------- | ------------------- |
| 0     | `generic`     | 0.5 m               |
| 1     | `genericflat` | 0.7 m               |
| 2     | `vekoma`      | 0.6 m               |
| 3     | `bm`          | 0.6 m               |
| 4     | `triangle`    | 0.5 m               |
| 5     | `box`         | 0.5 m               |
| 6     | `smallflat`   | 0.5 m               |
| 7     | `doublespine` | —                   |

Written at `track.cpp:997` as `sizeof(int)` = 4 bytes, big-endian on disk.

### 7.4 eFunctype — `function.h:27–34`

**Not serialized.** Implied by ordinal position in its owning section.

| Value | Symbol        |
| ----- | ------------- |
| 0     | `funcRoll`    |
| 1     | `funcNormal`  |
| 2     | `funcLateral` |
| 3     | `funcPitch`   |
| 4     | `funcYaw`     |

For `FRC` sections funcs 2/3 are normal/lateral g-forces; for `GEO` sections
the _same slots_ are reinterpreted as pitch/yaw rates. The distinction is
purely by section tag, never stored on the func itself.

### 7.5 eDegree — `subfunction.h:27–38`, serialized as `i32` at subfunc offset 0

| Value | Symbol       | `arg1` meaning                                            |
| ----- | ------------ | --------------------------------------------------------- |
| 0     | `linear`     | unused                                                    |
| 1     | `quadratic`  | sign determines "ease in" (`arg1 > 0`) vs "ease out" (`arg1 < 0`); `\|arg1\| < 0.5` ⇒ symmetric bump |
| 2     | `cubic`      | unused                                                    |
| 3     | `quartic`    | asymmetry parameter (default `-10.f` at creation)         |
| 4     | `quintic`    | asymmetry parameter (default `0.f`); `\|arg1\| < 0.005` ⇒ symmetric |
| 5     | `sinusoidal` | unused                                                    |
| 6     | `plateau`    | plateau sharpness (default `1.f`)                         |
| 7     | `tozero`     | derived at evaluation time — centered/tension zeroed (subfunction.cpp:134–137); do not trust the on-disk `arg1`/`centerArg`/`tensionArg` for this degree |
| 8     | `freeform`   | unused — **this degree loses its curve data on save/load; see §6.2** |

---

## 8. Legacy format `v0.30`

Source: `projectwidget.cpp:386–392`, track.cpp:1143–1259, all
`legacyLoadSection` methods, `function.cpp:175–187`, `subfunction.cpp:342–353`,
`smoothhandler.cpp:194–208`.

**Difference summary:** The on-disk layout is nearly identical. The legacy
path exists to tolerate a specific historical bug and slightly different
function behavior, but reading it produces exactly the same in-memory
structures modulo one field:

| Location                          | v0.77 behavior                                     | v0.30 behavior                                    |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| `secforced::legacyLoadSection`    | Reads `bSpeed` then `fVel` at offsets 3 & (8+N)    | Reads `bSpeed` (discarded), **does not read `fVel`**; forces `bSpeed = true` in memory (secforced.cpp:387). Rest of layout unchanged. |
| all other sections                | `loadSection` and `legacyLoadSection` are identical| same — delta is only that `Func::legacyLoadFunction` is called, which in turn calls `legacyLoadSubFunc` which is **bit-for-bit identical** to `loadSubFunc` (subfunction.cpp:342–353). There is no on-disk difference for subfuncs. |
| `smoothHandler::legacyLoadSmooth` | same layout                                        | byte-for-byte identical to `loadSmooth`           |

> **Practical takeaway:** for our importer the only material divergence is
> the `FRC` section missing `fVel` in v0.30. Everything else can be read
> with the v0.77 code path. FVD++'s loader warns users and auto-rewrites
> to v0.77 on next save ("Warning: Loaded old File Version. Please save to
> convert…", projectwidget.cpp:451).

> **Stringstream-only variant bug.** `secforced::saveSection(std::stringstream&)`
> at `secforced.cpp:396–413` emits a null byte where `bSpeed` should go
> (`writeNulls(&file, 1)`), **and omits `fVel`**. The fstream variant does
> neither. This only affects undo history (which is a `stringstream` blob
> in memory), not `.fvd` files — but it means the in-memory undo/redo
> snapshots do not perfectly round-trip `bSpeed` and `fVel` on forced sections.

---

## 9. Smoother record

Source: `smoothhandler.cpp:162–208`.

No tag. Smoothers are packed back-to-back after the `smootherCount` field.

| Offset | Size | Type    | Field       | Notes                                        |
| ------ | ---- | ------- | ----------- | -------------------------------------------- |
| 0      | 4    | i32     | nameLen     | read from the `treeItem->text(1)` QString    |
| 4      | N    | bytes   | name        | UTF-8                                        |
| 4+N    | 4    | i32     | fromNode    | node index (global track index), 0-based     |
| 8+N    | 4    | i32     | toNode      | inclusive end index; `-1` means "until end"  |
| 12+N   | 4    | i32     | length      | smoothing window length (nodes)              |
| 16+N   | 4    | i32     | iterations  | number of smoothing passes                   |
| 20+N   | 1    | u8 bool | active      | whether this smoother is applied             |

- There is **no "from-section / to-section"** in the on-disk record — the
  fields are `fromNode` / `toNode` in node space (see smoothhandler.h:59–62).
  The per-section smoother flag lives in `smoothHandler::sec` in memory and
  is reconstructed from node indices on load.
- `loadSmooth` calls `setFrom`/`setTo`/`setLength`/`setIterations`
  (smoothhandler.cpp:185–188) which clamp/validate; raw file values may be
  silently fixed up.
- The first smoother entry in a track is a sentinel created with section
  index `-1` (smoothhandler constructor default); it stores project-wide
  roll-smoothing settings.

---

## 10. Complete record-order summary

```
File
├── "FVD"
├── "v0.77"               (or "v0.30")
├── i32  texPathLen
├── utf8[texPathLen] texPath
├── Track[]               (0 or more, no count)
│   ├── "TRC"
│   ├── i32  nameLen
│   ├── utf8[nameLen] name
│   ├── bytes[48] trackColors          (whole-blob reversed)
│   ├── vec3B startPos                 (whole-blob reversed)
│   ├── f32  anchor.fRoll              (deg)
│   ├── f32  startPitch                (deg)
│   ├── f32  startYaw                  (deg)
│   ├── f32  anchor.fVel               (m/s)
│   ├── f32  anchor.forceNormal        (g)
│   ├── f32  anchor.forceLateral       (g)
│   ├── f32  fHeart                    (m)
│   ├── f32  fFriction
│   ├── f32  fResistance
│   ├── u8   drawTrack
│   ├── i32  drawHeartline
│   ├── i32  style                     (trackStyle enum)
│   ├── u8   isWireframe
│   ├── f32  povPos.x
│   ├── f32  povPos.y
│   ├── i32  sectionCount
│   ├── Section[sectionCount]
│   │   ├── "STR" | "CUR" | "FRC" | "GEO" | "BEZ" | "CSV"
│   │   └── … fields from §4.1-4.6
│   │       └── Func
│   │           ├── "FUNC"
│   │           ├── i32 subfuncCount
│   │           └── SubFunc[subfuncCount]    (33 bytes each)
│   ├── i32  smootherCount
│   ├── Smoother[smootherCount]
│   └── "EOT"
└── "EOP"
```

---

## 11. Known bugs and inconsistencies

| # | Location | Description | Our action |
|---|----------|-------------|------------|
| 1 | `writeBytes` (exportfuncs.cpp:24–29) | Whole-buffer reversal rather than per-primitive swap. Produces big-endian primitives only because every named primitive is passed individually. Larger blobs (`QColor[3]`, `glm::vec3` via `sizeof(glm::vec3)`) are reversed as one unit and rely on compiler argument-evaluation order in `readVec3` to round-trip. | Document; on read, swap whole 12-byte vec3 blobs into `(x, y, z)` explicitly. |
| 2 | `track.cpp:978/1030` | `3*sizeof(QColor)` = 48 bytes of Qt-internal struct layout leaked into the file. | Treat as opaque; emit defaults on export. |
| 3 | `secforced.cpp:379–394` | `legacyLoadSection` reads `bSpeed` then discards it and forces `bSpeed=true`; **does not read `fVel`**. | Branch on version tag. |
| 4 | `secforced.cpp:396–413` vs `:342–360` | fstream and stringstream `saveSection` disagree on whether to write `bSpeed` and `fVel`. Stringstream writes a null byte and omits `fVel`. | Only affects undo history; document, do not emulate. |
| 5 | `subfunction.cpp` | Freeform (`degree=8`) `pointList`/`valueList` not serialized. | Refuse to emit; warn on import. |
| 6 | `subfunction.cpp:329` vs `:355` | fstream `loadSubFunc` does not call `changeLength`; stringstream does. | On fstream load, let the section loader reconstruct lengths (which FVD++ does). |
| 7 | `exportfuncs.cpp:50–56, 132–140` | `readNulls` accepts non-zero bytes silently (intended-to-be-strict check commented out). | Harmless; do not assume padding bytes are zero. |
| 8 | Project | No checksum, no version per-record, no length prefix at record level. Truncated or corrupt files can cascade into gigabyte-sized string reads if `nameLen` is garbage. | Our reader must bounds-check every length field against remaining file size before allocating. |
| 9 | `readVec3` | Constructor-argument evaluation order is unspecified in C++; FVD++'s readers depend on GCC's right-to-left evaluation for correctness on 12-byte whole-blob-reversed vec3s. | Port deterministically — read three floats into named locals, then construct the vec3. |
| 10 | `secnlcsv.cpp:131` | `CSV` section has no name, no bSpeed, no fVel, no roll func — just a node array. Contradicts every other section. | Expect and handle. |

---

## 12. Things that are *not* in the file

For completeness, the following in-memory state is recomputed rather than stored:

- `section::length`, `section::lNodes` (all per-node kinematics). Regenerated
  by `updateSection()` on load.
- `mnode::fEnergy`, `fRollSpeed`, `fPitchFromLast`, `fYawFromLast`, `vNorm`,
  `vLat`, etc. All recomputed.
- `bezier_t::ptf, fvdRoll, length, numNodes, fVel, equalDist`. Recomputed.
- `subfunc::pointList`, `subfunc::valueList` (see bug #5).
- `trackHandler::trackColors` beyond the raw 48 bytes — no semantic meaning
  is stored.
- UI state beyond `povPos`, `drawTrack`, `drawHeartline`, `isWireframe`, `style`.
- Per-section force preview samples, graph view state, selection.

A minimal conforming writer therefore needs: tag, all primitives in §1–6,
and can leave every derived datum to the re-simulation pass at load time.
