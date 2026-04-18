// SPDX-License-Identifier: AGPL-3.0-only

import { type TrackStream } from '@roller-coaster-designer/worker';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';

import { colorHexToInt, sectionColor } from './section-colors.js';

/**
 * Simplified single-style ("GenericFlat" — 2 tubular rails + spaced
 * crossties, no spine) track mesh. The full 8-style switch from FVD++'s
 * trackmesh.cpp lands in a later M7 slice; this first pass proves the
 * sweep / adaptive-tessellation / per-section colouring pipeline.
 */

export interface TrackMeshParams {
  /** Half-distance between rails along the lateral axis (m). */
  readonly railSpacingHalf: number;
  /** Tube radius for each rail (m). */
  readonly railRadius: number;
  /** Distance BELOW the heart line (along the track's normal axis) that
   *  the rails sit at. In FVD++ the heart line is the rider's heart —
   *  actual rails are 1.0–1.2 m below, depending on the track style. */
  readonly heartOffset: number;
  /** Ring tessellation (triangles around the tube). More = smoother but
   *  more vertices. 8 is enough at typical zoom levels. */
  readonly ringSegments: number;
  /** Max distance between mesh rings along the heart line (m). Denser
   *  rings happen naturally on curves via the angle threshold below. */
  readonly maxRingStep: number;
  /** Accumulated bend angle that forces a new ring (radians). */
  readonly angleStep: number;
  /** Crosstie spacing (m). */
  readonly crosstieStep: number;
  /** Crosstie dimensions (length perpendicular to rails × thickness). */
  readonly crosstieWidth: number;
  readonly crosstieThickness: number;
}

export const DEFAULT_TRACK_MESH_PARAMS: TrackMeshParams = {
  railSpacingHalf: 0.35,
  railRadius: 0.05,
  heartOffset: 1.1,
  ringSegments: 8,
  maxRingStep: 0.8,
  angleStep: (Math.PI / 180) * 5,
  crosstieStep: 1.4,
  crosstieWidth: 0.95,
  crosstieThickness: 0.06,
};

interface SectionRun {
  readonly sectionIndex: number;
  readonly start: number;
  readonly endExclusive: number;
}

function computeSectionRuns(sectionIndex: Uint16Array, count: number): SectionRun[] {
  const runs: SectionRun[] = [];
  if (count === 0) return runs;
  let runStart = 0;
  let currentSection = sectionIndex[0] ?? 0;
  for (let i = 1; i < count; i += 1) {
    const si = sectionIndex[i] ?? currentSection;
    if (si !== currentSection) {
      runs.push({ sectionIndex: currentSection, start: runStart, endExclusive: i + 1 });
      runStart = i;
      currentSection = si;
    }
  }
  runs.push({ sectionIndex: currentSection, start: runStart, endExclusive: count });
  return runs;
}

/** Scratch vectors reused across the hot loop to avoid per-frame garbage. */
const dirVec = new Vector3();
const latVec = new Vector3();
const normVec = new Vector3();
const ringCentre = new Vector3();
const ringVertex = new Vector3();
const prevDir = new Vector3();

/**
 * Adaptively samples nodes of a run and returns the indices to emit rings
 * at. Starts and ends are always included; in between, a new ring is
 * emitted when either the cumulative bend angle or the distance traveled
 * since the last ring crosses its threshold.
 */
function sampleRingIndices(
  positions: Float32Array,
  run: SectionRun,
  params: TrackMeshParams,
): number[] {
  const samples: number[] = [];
  samples.push(run.start);
  let lastIdx = run.start;
  let accumAngle = 0;
  prevDir.set(0, 0, 0);

  for (let i = run.start + 1; i < run.endExclusive; i += 1) {
    const dx = positions[i * 3]! - positions[lastIdx * 3]!;
    const dy = positions[i * 3 + 1]! - positions[lastIdx * 3 + 1]!;
    const dz = positions[i * 3 + 2]! - positions[lastIdx * 3 + 2]!;
    const dist = Math.hypot(dx, dy, dz);

    // Angle between this segment's direction and the previous one. Only
    // computed when we have a previous direction to compare against.
    const segLen = Math.hypot(
      positions[i * 3]! - positions[(i - 1) * 3]!,
      positions[i * 3 + 1]! - positions[(i - 1) * 3 + 1]!,
      positions[i * 3 + 2]! - positions[(i - 1) * 3 + 2]!,
    );
    if (segLen > 1e-6) {
      const sx = (positions[i * 3]! - positions[(i - 1) * 3]!) / segLen;
      const sy = (positions[i * 3 + 1]! - positions[(i - 1) * 3 + 1]!) / segLen;
      const sz = (positions[i * 3 + 2]! - positions[(i - 1) * 3 + 2]!) / segLen;
      if (prevDir.lengthSq() > 0) {
        const dot = Math.max(-1, Math.min(1, prevDir.x * sx + prevDir.y * sy + prevDir.z * sz));
        accumAngle += Math.acos(dot);
      }
      prevDir.set(sx, sy, sz);
    }

    const emit =
      i === run.endExclusive - 1 || dist >= params.maxRingStep || accumAngle >= params.angleStep;
    if (emit) {
      samples.push(i);
      lastIdx = i;
      accumAngle = 0;
    }
  }
  return samples;
}

/**
 * Builds a single rail tube mesh (indexed triangles) along the given
 * ringIndices, offset `lateralOffset` from the heart line along the
 * track's lateral axis. Uses `ringSegments` edges around the tube.
 */
function buildRailGeometry(
  track: TrackStream,
  ringIndices: readonly number[],
  lateralOffset: number,
  params: TrackMeshParams,
): BufferGeometry {
  const N = params.ringSegments;
  const ringCount = ringIndices.length;
  const vertexCount = ringCount * N;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const cosLut = new Float32Array(N);
  const sinLut = new Float32Array(N);
  for (let k = 0; k < N; k += 1) {
    const a = (k / N) * Math.PI * 2;
    cosLut[k] = Math.cos(a);
    sinLut[k] = Math.sin(a);
  }

  for (let r = 0; r < ringCount; r += 1) {
    const ni = ringIndices[r]!;
    // Build local frame at this node: lat from the stream, dir from
    // neighbouring positions, norm = lat × dir.
    const nextNi = Math.min(ni + 1, track.nodeCount - 1);
    const prevNi = Math.max(ni - 1, 0);
    dirVec.set(
      track.positions[nextNi * 3]! - track.positions[prevNi * 3]!,
      track.positions[nextNi * 3 + 1]! - track.positions[prevNi * 3 + 1]!,
      track.positions[nextNi * 3 + 2]! - track.positions[prevNi * 3 + 2]!,
    );
    if (dirVec.lengthSq() < 1e-10) dirVec.set(0, 0, 1);
    dirVec.normalize();
    latVec.set(
      track.lateralAxis[ni * 3]!,
      track.lateralAxis[ni * 3 + 1]!,
      track.lateralAxis[ni * 3 + 2]!,
    );
    normVec.crossVectors(latVec, dirVec).normalize();
    ringCentre.set(
      track.positions[ni * 3]!,
      track.positions[ni * 3 + 1]!,
      track.positions[ni * 3 + 2]!,
    );
    // Rails sit `heartOffset` below the integrated heart line along the
    // track's normal axis, then offset laterally for left/right rail.
    ringCentre.addScaledVector(normVec, -params.heartOffset);
    ringCentre.addScaledVector(latVec, lateralOffset);

    for (let k = 0; k < N; k += 1) {
      // local offset in (lat, norm) plane of radius `railRadius`.
      const ox = cosLut[k]! * params.railRadius;
      const oy = sinLut[k]! * params.railRadius;
      ringVertex.copy(ringCentre).addScaledVector(latVec, ox).addScaledVector(normVec, oy);
      const vi = (r * N + k) * 3;
      positions[vi] = ringVertex.x;
      positions[vi + 1] = ringVertex.y;
      positions[vi + 2] = ringVertex.z;
      // Outward normal: lat * cos + norm * sin.
      normals[vi] = latVec.x * cosLut[k]! + normVec.x * sinLut[k]!;
      normals[vi + 1] = latVec.y * cosLut[k]! + normVec.y * sinLut[k]!;
      normals[vi + 2] = latVec.z * cosLut[k]! + normVec.z * sinLut[k]!;
    }
  }

  const quadCount = (ringCount - 1) * N;
  const indices = new Uint32Array(quadCount * 6);
  let w = 0;
  for (let r = 0; r < ringCount - 1; r += 1) {
    for (let k = 0; k < N; k += 1) {
      const a = r * N + k;
      const b = r * N + ((k + 1) % N);
      const c = (r + 1) * N + k;
      const d = (r + 1) * N + ((k + 1) % N);
      indices[w++] = a;
      indices[w++] = c;
      indices[w++] = b;
      indices[w++] = b;
      indices[w++] = c;
      indices[w++] = d;
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('normal', new BufferAttribute(normals, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  return geom;
}

/** Single crosstie as a thin box oriented to match the lateral × normal plane. */
function buildCrossties(track: TrackStream, params: TrackMeshParams): Mesh | null {
  // Walk cumulativeTime as a cheap distance proxy won't work; use positions.
  const n = track.nodeCount;
  if (n < 2) return null;
  const stepIndices: number[] = [];
  let accum = 0;
  stepIndices.push(0);
  for (let i = 1; i < n; i += 1) {
    const dx = track.positions[i * 3]! - track.positions[(i - 1) * 3]!;
    const dy = track.positions[i * 3 + 1]! - track.positions[(i - 1) * 3 + 1]!;
    const dz = track.positions[i * 3 + 2]! - track.positions[(i - 1) * 3 + 2]!;
    accum += Math.hypot(dx, dy, dz);
    if (accum >= params.crosstieStep) {
      stepIndices.push(i);
      accum = 0;
    }
  }
  if (stepIndices.length < 2) return null;

  const group = new Group();
  const tieGeom = new BoxGeometry(
    params.crosstieWidth,
    params.crosstieThickness,
    params.crosstieThickness * 2,
  );
  const tieMat = new MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.8, metalness: 0.1 });
  for (const ni of stepIndices) {
    const tie = new Mesh(tieGeom, tieMat);
    tie.castShadow = true;
    tie.receiveShadow = true;
    // Orient the box: +X along lat, +Y along -norm (so the tie sits just
    // under the rails and catches the directional light from above).
    const nextNi = Math.min(ni + 1, track.nodeCount - 1);
    const prevNi = Math.max(ni - 1, 0);
    dirVec.set(
      track.positions[nextNi * 3]! - track.positions[prevNi * 3]!,
      track.positions[nextNi * 3 + 1]! - track.positions[prevNi * 3 + 1]!,
      track.positions[nextNi * 3 + 2]! - track.positions[prevNi * 3 + 2]!,
    );
    if (dirVec.lengthSq() < 1e-10) continue;
    dirVec.normalize();
    latVec.set(
      track.lateralAxis[ni * 3]!,
      track.lateralAxis[ni * 3 + 1]!,
      track.lateralAxis[ni * 3 + 2]!,
    );
    normVec.crossVectors(latVec, dirVec).normalize();
    tie.position.set(
      track.positions[ni * 3]!,
      track.positions[ni * 3 + 1]!,
      track.positions[ni * 3 + 2]!,
    );
    // Ties sit just below the rails, which are themselves `heartOffset`
    // below the heart line. Same frame as buildRailGeometry.
    tie.position.addScaledVector(
      normVec,
      -params.heartOffset - params.railRadius - params.crosstieThickness,
    );
    tie.matrixAutoUpdate = false;
    // Row-major basis: columns (lat, -norm, dir). Three expects column
    // layout in .matrix.elements but the four-arg setBasis trick needs
    // `makeBasis` — use that for clarity.
    tie.matrix.makeBasis(latVec, normVec.clone().negate(), dirVec).setPosition(tie.position);
    group.add(tie);
  }
  (group as unknown as { __shared_tieGeom: BoxGeometry }).__shared_tieGeom = tieGeom;
  (group as unknown as { __shared_tieMat: MeshStandardMaterial }).__shared_tieMat = tieMat;
  return group as unknown as Mesh;
}

/** Brighten a hex color by a multiplier (clamped per-channel). */
function brighten(hex: number, mul: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * mul));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * mul));
  const b = Math.min(255, Math.round((hex & 0xff) * mul));
  return (r << 16) | (g << 8) | b;
}

export interface BuiltTrackMesh {
  readonly group: Group;
  /** Per-pickable mesh → section mapping. Used for click-to-select. */
  readonly pickables: readonly { readonly sectionIndex: number; readonly mesh: Mesh }[];
  dispose(): void;
}

export function buildTubularTrackMesh(
  track: TrackStream,
  sectionColorsOverride: readonly string[] | undefined,
  selectedSectionIndex: number | null | undefined,
  paramsOverride?: Partial<TrackMeshParams>,
): BuiltTrackMesh {
  const params: TrackMeshParams = paramsOverride
    ? { ...DEFAULT_TRACK_MESH_PARAMS, ...paramsOverride }
    : DEFAULT_TRACK_MESH_PARAMS;
  const group = new Group();
  const pickables: { sectionIndex: number; mesh: Mesh }[] = [];
  const disposeList: { dispose(): void }[] = [];

  if (track.nodeCount < 2) {
    return {
      group,
      pickables,
      dispose: () => {
        for (const d of disposeList) d.dispose();
      },
    };
  }

  const runs = computeSectionRuns(track.sectionIndex, track.nodeCount);
  const HIGHLIGHT = 1.4;
  for (const run of runs) {
    // Rings skip the first sample of all but the first run so consecutive
    // sections share a boundary ring without doubling it.
    const ringIndices = sampleRingIndices(track.positions, run, params);
    if (ringIndices.length < 2) continue;

    const baseHex = colorHexToInt(
      sectionColorsOverride?.[run.sectionIndex] ?? sectionColor(run.sectionIndex),
    );
    const isSelected = run.sectionIndex === selectedSectionIndex;
    const color = new Color(isSelected ? brighten(baseHex, HIGHLIGHT) : baseHex);
    const mat = new MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.35,
      emissive: isSelected ? new Color(baseHex).multiplyScalar(0.15) : new Color(0x000000),
    });
    disposeList.push(mat);

    for (const offset of [-params.railSpacingHalf, +params.railSpacingHalf]) {
      const geom = buildRailGeometry(track, ringIndices, offset, params);
      disposeList.push(geom);
      const mesh = new Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      pickables.push({ sectionIndex: run.sectionIndex, mesh });
    }
  }

  const ties = buildCrossties(track, params);
  if (ties) {
    group.add(ties);
    const shared = ties as unknown as {
      __shared_tieGeom: BoxGeometry;
      __shared_tieMat: MeshStandardMaterial;
    };
    disposeList.push(shared.__shared_tieGeom);
    disposeList.push(shared.__shared_tieMat);
  }

  return {
    group,
    pickables,
    dispose: () => {
      for (const d of disposeList) d.dispose();
    },
  };
}
