// SPDX-License-Identifier: AGPL-3.0-only

import { type TrackStream } from '@roller-coaster-designer/worker';
import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  AxesHelper,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Line,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  Sphere,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { colorHexToInt, sectionColor } from './section-colors.js';

export type CameraMode = 'orbit' | 'pov';

export interface ViewportProps {
  readonly tracks: readonly TrackStream[];
  /**
   * Hex color per section (same order as the track's sections). Used to
   * tint the rails per section. Missing entries fall back to the default
   * palette.
   */
  readonly sectionColors?: readonly string[];
  /** Selected section; its rails brighten and thicken. */
  readonly selectedSectionIndex?: number | null;
  /** Orbit (fly-around) or POV (ride-through). Changes camera + controls. */
  readonly cameraMode?: CameraMode;
}

interface SceneRefs {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  lines: Line[];
  ro: ResizeObserver;
  frame: number;
  /** Identity of the track bound last (by reference). Reset to reframe. */
  framedTrack: TrackStream | null;
  cameraMode: CameraMode;
  /** Seconds since the POV ride started. Advances with clock delta while
   *  cameraMode === 'pov'. Looped modulo track duration. */
  povTime: number;
  /** Last animation-frame timestamp, for dt. */
  lastFrameMs: number;
}

const RAIL_HALF_WIDTH = 0.3;
const CROSSTIE_EVERY_N_NODES = 120;
const HIGHLIGHT_MULTIPLIER = 1.6; // brighten the selected section's rails

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function disposeLines(state: SceneRefs): void {
  for (const line of state.lines) {
    state.scene.remove(line);
    line.geometry.dispose();
    (line.material as LineBasicMaterial).dispose();
  }
  state.lines = [];
}

const frameBox = new Box3();
const frameSphere = new Sphere();
const frameCentre = new Vector3();

/**
 * Positions the orbit camera so the whole track is visible, then centres
 * OrbitControls on the track's bounding-sphere centre. The camera sits on
 * the +X+Y+Z octant at distance `radius / sin(fov/2) * 1.3` — the 1.3×
 * padding keeps the rails off the viewport edges.
 */
function frameCamera(state: SceneRefs, track: TrackStream): void {
  const positions = track.positions;
  const n = track.nodeCount;
  if (n === 0) return;

  frameBox.makeEmpty();
  for (let i = 0; i < n; i += 1) {
    frameBox.expandByPoint(
      frameCentre.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!),
    );
  }
  frameBox.getBoundingSphere(frameSphere);
  const centre = frameSphere.center;
  const radius = Math.max(5, frameSphere.radius);

  const fovRad = (state.camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fovRad / 2)) * 1.3;

  // Camera at 45° off the forward axis, slightly above, looking at the
  // bounding-sphere centre. Matches the M2 default but scaled to fit.
  const dir = new Vector3(1, 0.55, 1).normalize();
  state.camera.position.copy(centre).addScaledVector(dir, distance);
  state.camera.lookAt(centre);
  state.controls.target.copy(centre);
  // Give OrbitControls enough zoom range to frame both close-ups and
  // the whole track.
  state.controls.minDistance = radius * 0.05;
  state.controls.maxDistance = distance * 4;
  state.controls.update();
}

const povPos = new Vector3();
const povDir = new Vector3();
const povLat = new Vector3();
const povUp = new Vector3();

const POV_CAMERA_OFFSET_UP = 1.2; // sit the camera above the heart line

/**
 * Advances the POV camera along the track by `dtSeconds` of simulated time.
 * cumulativeTime is already in seconds (one entry per node at 1000 Hz), so
 * we do a binary search over it to find the current node. Loops at track
 * end.
 */
function advancePov(state: SceneRefs, dtSeconds: number): void {
  const track = state.framedTrack;
  if (!track || track.nodeCount < 2) return;

  const totalSeconds = track.cumulativeTime[track.nodeCount - 1]!;
  if (totalSeconds <= 0) return;

  state.povTime = (state.povTime + dtSeconds) % totalSeconds;

  const index = binarySearchTime(track.cumulativeTime, track.nodeCount, state.povTime);
  const i = Math.min(index, track.nodeCount - 2);
  const t0 = track.cumulativeTime[i]!;
  const t1 = track.cumulativeTime[i + 1]!;
  const u = t1 > t0 ? (state.povTime - t0) / (t1 - t0) : 0;

  // Lerp position and lat between nodes for smooth sub-tick motion.
  const ax = track.positions[i * 3]!;
  const ay = track.positions[i * 3 + 1]!;
  const az = track.positions[i * 3 + 2]!;
  const bx = track.positions[(i + 1) * 3]!;
  const by = track.positions[(i + 1) * 3 + 1]!;
  const bz = track.positions[(i + 1) * 3 + 2]!;
  povPos.set(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u);

  const alx = track.lateralAxis[i * 3]!;
  const aly = track.lateralAxis[i * 3 + 1]!;
  const alz = track.lateralAxis[i * 3 + 2]!;
  povLat.set(alx, aly, alz);
  povDir.set(bx - ax, by - ay, bz - az).normalize();
  povUp.crossVectors(povLat, povDir).normalize();

  // Sit the camera slightly above the rail so you see the approaching track.
  state.camera.position.copy(povPos).addScaledVector(povUp, POV_CAMERA_OFFSET_UP);
  state.camera.up.copy(povUp);
  state.camera.lookAt(povPos.x + povDir.x * 5, povPos.y + povDir.y * 5, povPos.z + povDir.z * 5);
}

function binarySearchTime(times: Float32Array, n: number, t: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((times[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? lo - 1 : 0;
}

/** Runs of same-section-index node ranges as half-open [start, endExclusive]. */
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

/** Brighten a hex color by `mul` (clamped to 0..255 per channel). */
function brighten(hex: number, mul: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * mul));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * mul));
  const b = Math.min(255, Math.round((hex & 0xff) * mul));
  return (r << 16) | (g << 8) | b;
}

export function Viewport({
  tracks,
  sectionColors,
  selectedSectionIndex,
  cameraMode,
}: ViewportProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<SceneRefs | null>(null);
  const [webglSupported] = useState(hasWebGL);

  useEffect(() => {
    if (!webglSupported) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.append(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color(0x0b0b0b);

    const grid = new GridHelper(200, 40, 0x333333, 0x222222);
    scene.add(grid);

    // World axes — R = +X (forward), G = +Y (up), B = +Z (right). 5 m long
    // so the colours register at default zoom. Placed at the world origin.
    // A proper draggable ViewCube/gizmo is deferred to M7 (spec §20b).
    const axes = new AxesHelper(5);
    scene.add(axes);

    scene.add(new AmbientLight(0xffffff, 0.6));
    const dir = new DirectionalLight(0xffffff, 0.7);
    dir.position.set(10, 20, 15);
    scene.add(dir);

    const camera = new PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 2000);
    camera.position.set(30, 20, 30);
    camera.lookAt(0, 5, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 5, 0);
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.9;

    const state: SceneRefs = {
      renderer,
      scene,
      camera,
      controls,
      lines: [],
      frame: 0,
      framedTrack: null,
      cameraMode: 'orbit',
      povTime: 0,
      lastFrameMs: performance.now(),
      ro: new ResizeObserver(() => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }),
    };
    state.ro.observe(host);
    refs.current = state;

    const loop = (now: number): void => {
      const dt = Math.max(0, (now - state.lastFrameMs) / 1000);
      state.lastFrameMs = now;

      if (state.cameraMode === 'pov') {
        advancePov(state, dt);
      } else {
        state.controls.update();
      }
      state.renderer.render(state.scene, state.camera);
      state.frame = requestAnimationFrame(loop);
    };
    state.frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(state.frame);
      state.ro.disconnect();
      state.controls.dispose();
      disposeLines(state);
      renderer.dispose();
      renderer.domElement.remove();
      refs.current = null;
    };
  }, [webglSupported]);

  // React to camera-mode changes independently of geometry so toggling
  // POV / Orbit doesn't force a rebuild of the rails.
  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    const next: CameraMode = cameraMode === 'pov' ? 'pov' : 'orbit';
    if (state.cameraMode === next) return;
    state.cameraMode = next;
    state.controls.enabled = next === 'orbit';
    if (next === 'pov') {
      state.povTime = 0;
    } else {
      // Back to orbit: re-frame the track so the user isn't stuck at the last
      // POV position.
      if (tracks[0]) frameCamera(state, tracks[0]);
    }
  }, [cameraMode, tracks]);

  // Swap the rendered lines whenever recompute hands us new node streams,
  // or the user selects a different section (highlight).
  useEffect(() => {
    const state = refs.current;
    if (!state) return;

    disposeLines(state);

    if (tracks.length === 0) {
      state.framedTrack = null;
      return;
    }
    const first = tracks[0];
    if (!first || first.nodeCount === 0) return;

    // Auto-fit on first recompute for a new track reference. We intentionally
    // frame only on reference change (not every recompute) so that editing a
    // parameter doesn't yank the camera every keystroke.
    if (state.framedTrack !== first) {
      frameCamera(state, first);
      state.framedTrack = first;
    }

    const n = first.nodeCount;

    // Pre-compute rail vertex streams once; per-section runs each take a
    // slice of these buffers via setDrawRange.
    const railLeft = new Float32Array(n * 3);
    const railRight = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const px = first.positions[i * 3]!;
      const py = first.positions[i * 3 + 1]!;
      const pz = first.positions[i * 3 + 2]!;
      const lx = first.lateralAxis[i * 3]!;
      const ly = first.lateralAxis[i * 3 + 1]!;
      const lz = first.lateralAxis[i * 3 + 2]!;
      railLeft[i * 3] = px - lx * RAIL_HALF_WIDTH;
      railLeft[i * 3 + 1] = py - ly * RAIL_HALF_WIDTH;
      railLeft[i * 3 + 2] = pz - lz * RAIL_HALF_WIDTH;
      railRight[i * 3] = px + lx * RAIL_HALF_WIDTH;
      railRight[i * 3 + 1] = py + ly * RAIL_HALF_WIDTH;
      railRight[i * 3 + 2] = pz + lz * RAIL_HALF_WIDTH;
    }

    // Centreline: translucent grey so it doesn't fight with colored rails.
    const centreGeom = new BufferGeometry();
    centreGeom.setAttribute('position', new BufferAttribute(first.positions, 3));
    centreGeom.setDrawRange(0, n);
    const centre = new Line(
      centreGeom,
      new LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.4 }),
    );
    state.scene.add(centre);
    state.lines.push(centre);

    // One pair of rail lines per section run. Using shared BufferGeometries
    // and setDrawRange on copies would require per-material reuse — simpler
    // to clone per run; 50-section tracks are still cheap.
    const runs = computeSectionRuns(first.sectionIndex, n);
    for (const run of runs) {
      const baseHex = colorHexToInt(
        sectionColors?.[run.sectionIndex] ?? sectionColor(run.sectionIndex),
      );
      const isSelected = run.sectionIndex === selectedSectionIndex;
      const hex = isSelected ? brighten(baseHex, HIGHLIGHT_MULTIPLIER) : baseHex;
      const width = isSelected ? 2 : 1;

      for (const vertices of [railLeft, railRight]) {
        const geom = new BufferGeometry();
        geom.setAttribute('position', new BufferAttribute(vertices, 3));
        geom.setDrawRange(run.start, run.endExclusive - run.start);
        const mat = new LineBasicMaterial({ color: hex, linewidth: width });
        const line = new Line(geom, mat);
        state.scene.add(line);
        state.lines.push(line);
      }
    }

    // Cross-ties.
    const ties: number[] = [];
    for (let i = 0; i < n; i += CROSSTIE_EVERY_N_NODES) {
      ties.push(railLeft[i * 3]!, railLeft[i * 3 + 1]!, railLeft[i * 3 + 2]!);
      ties.push(railRight[i * 3]!, railRight[i * 3 + 1]!, railRight[i * 3 + 2]!);
    }
    if (ties.length > 0) {
      const tiesGeom = new BufferGeometry();
      tiesGeom.setAttribute('position', new BufferAttribute(new Float32Array(ties), 3));
      const tiesLine = new LineSegments(tiesGeom, new LineBasicMaterial({ color: 0x666666 }));
      state.scene.add(tiesLine);
      state.lines.push(tiesLine as unknown as Line);
    }
  }, [tracks, sectionColors, selectedSectionIndex]);

  if (!webglSupported) {
    return (
      <div
        role="img"
        aria-label="viewport"
        className="flex h-full w-full items-center justify-center bg-surface-0 p-6 text-center text-xs text-neutral-500"
      >
        WebGL is required to render the 3D viewport.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="viewport"
      className="relative h-full w-full select-none bg-surface-0"
      style={{ touchAction: 'none' }}
    />
  );
}
