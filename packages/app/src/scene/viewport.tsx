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
  Mesh,
  OrthographicCamera,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  EquirectangularReflectionMapping,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  ShadowMaterial,
  TextureLoader,
  type Texture,
  Sphere,
  SphereGeometry,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { colorHexToInt, sectionColor } from './section-colors.js';
import { buildTubularTrackMesh, type BuiltTrackMesh } from './track-mesh.js';
import { createViewCube, type ViewCube, type ViewCubeLabels } from './view-cube.js';

export type CameraMode = 'orbit' | 'pov';
export type RenderStyle = 'ribbon' | 'tubular';
export type Projection = 'perspective' | 'ortho';

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
  /**
   * Incrementing epoch — framing only runs when this number changes. App
   * bumps it on File → New / Open / Load Demo and on user-clicked Fit; a
   * parameter edit that only mutates section data leaves it alone, so the
   * camera doesn't yank on every slider move.
   */
  readonly fitEpoch?: number;
  /** Incrementing epoch — resets camera to the default angle on change. */
  readonly resetEpoch?: number;
  /** Localized labels for the ViewCube faces. */
  readonly cubeLabels?: ViewCubeLabels;
  /** Called when the user clicks a rail in the 3D view. `null` means the
   *  click hit empty space (and should clear selection). */
  readonly onSelectSection?: (index: number | null) => void;
  /** 'tubular' (default) renders the M7 mesh pipeline; 'ribbon' keeps the
   *  fast three-line debug overlay — useful for long tracks or when the
   *  mesh profile hides banking you want to see. */
  readonly renderStyle?: RenderStyle;
  /** Called when the user clicks the cube's Home button. App wires this
   *  to `requestResetView` so the camera returns to the default pose. */
  readonly onHome?: () => void;
  /** 'perspective' (default) keeps the current FOV-driven view; 'ortho'
   *  switches to a blueprint-style parallel projection. POV mode always
   *  stays perspective regardless of this prop. */
  readonly projection?: Projection;
  /** When true, draws a thin highlight ribbon along the heart centreline
   *  on top of the rails. Works in both tubular and ribbon modes. */
  readonly showHeartline?: boolean;
  /** Distance (m) from the heart line down to the rails along the track's
   *  normal axis. Matches `Track.heart` in the project model. Defaults to
   *  1.1 m, the typical rider-heart-above-rail distance for a B&M/Vekoma-
   *  class coaster. */
  readonly heartOffset?: number;
  /** Four world-space control points of the currently-selected Bezier
   *  section. `null` hides the transform handles. Handles use the same
   *  per-section colour so it's obvious which section they belong to. */
  readonly bezierHandles?:
    | readonly [
        [number, number, number],
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ]
    | null;
  /** Called when the user finishes dragging a Bezier handle. Drag-in-
   *  progress updates stay local to the sphere mesh so the worker isn't
   *  retriggered mid-drag; commit happens on release. */
  readonly onBezierHandleChange?: (index: 0 | 1 | 2 | 3, pos: [number, number, number]) => void;
  /** Equirectangular sky image (data URI) applied to `scene.background`
   *  / `scene.environment`. `null` keeps the default dark background. */
  readonly skyDataUri?: string | null;
  /** Floor image (data URI). Overrides `floorColor` when present. */
  readonly floorDataUri?: string | null;
  /** Fallback floor colour (hex) applied to the shadow-receiving ground
   *  when no `floorDataUri` is set. */
  readonly floorColor?: string;
  /** When false, the ground plane is hidden entirely (no shadows, no
   *  colour, no grid-catching plane). */
  readonly floorVisible?: boolean;
  /** World-metres per floor-texture tile. The ground plane is 500×500 m, so
   *  e.g. 10 m/tile produces a 50×50 repeat. Updates take effect on the
   *  currently-loaded texture without forcing a reload. */
  readonly floorTileMeters?: number;
}

interface CameraTween {
  readonly fromPos: Vector3;
  readonly fromUp: Vector3;
  readonly toPos: Vector3;
  readonly toUp: Vector3;
  /** Performance-clock start (ms) and duration (ms). */
  readonly startMs: number;
  readonly durationMs: number;
}

interface Pickable {
  /** Index into the Track.sections array this pickable belongs to. */
  readonly sectionIndex: number;
  /** Line for ribbon mode, Mesh for tubular mode. */
  readonly obj: Object3D;
}

interface SceneRefs {
  renderer: WebGLRenderer;
  scene: Scene;
  /** Active orbit-mode camera (perspective OR ortho depending on prop). */
  camera: PerspectiveCamera | OrthographicCamera;
  /** Persistent perspective camera. Always used in POV mode; used in orbit
   *  mode when projection === 'perspective'. */
  perspCamera: PerspectiveCamera;
  /** Persistent orthographic camera. Used in orbit mode when projection
   *  === 'ortho'. */
  orthoCamera: OrthographicCamera;
  controls: OrbitControls;
  lines: Line[];
  /** Tubular-style mesh (when active). Disposed on rebuild / style change. */
  builtMesh: BuiltTrackMesh | null;
  /** Two narrow lines drawn along the heart line when `showHeartline` is
   *  on. Lives in its own effect so toggling the overlay doesn't rebuild
   *  rails + retrigger the auto-fit. */
  heartlineObj: Line[] | null;
  /** Section-tagged Objects for click-to-select raycasting. Populated by
   *  whichever render style is currently active. */
  pickables: Pickable[];
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
  cube: ViewCube;
  /** Active tween (if any) for ViewCube-driven camera snapping. */
  tween: CameraTween | null;
  /** Where pointerdown started, for distinguishing click from orbit-drag. */
  pointerDown: { x: number; y: number; time: number } | null;
  /** TransformControls + its 4 handle proxy meshes for the currently-
   *  selected Bezier section. `null` when no Bezier is selected. */
  transform: TransformControls | null;
  handleMeshes: Mesh[];
  /** Index of the handle TransformControls is currently attached to. */
  activeHandleIndex: number | null;
  /** Ground plane mesh; its material is swapped between ShadowMaterial
   *  (transparent, with grid visible) and MeshStandardMaterial (solid
   *  colour or textured) depending on env props. */
  ground: Mesh;
  /** Current background texture (if any). Disposed on swap. */
  skyTexture: Texture | null;
  /** Current floor texture (if any). Disposed on swap. */
  floorTexture: Texture | null;
}

const RAIL_HALF_WIDTH = 0.3;
const CROSSTIE_EVERY_N_NODES = 120;
const GROUND_SIZE_M = 500;
const HIGHLIGHT_MULTIPLIER = 1.6; // brighten the selected section's rails
const CUBE_TWEEN_MS = 400;
const CLICK_MOVE_PX = 4; // max pointer movement to still count as "click"
const CLICK_MAX_MS = 300;
const DEFAULT_CUBE_LABELS: ViewCubeLabels = {
  top: 'Top',
  bottom: 'Bottom',
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  rotateCw: 'Rotate clockwise',
  rotateCcw: 'Rotate counter-clockwise',
};

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function disposeHandleMeshes(state: SceneRefs): void {
  for (const m of state.handleMeshes) {
    state.scene.remove(m);
    m.geometry.dispose();
    (m.material as MeshBasicMaterial).dispose();
  }
  state.handleMeshes = [];
}

function disposeTrackGeometry(state: SceneRefs): void {
  for (const line of state.lines) {
    state.scene.remove(line);
    line.geometry.dispose();
    (line.material as LineBasicMaterial).dispose();
  }
  state.lines = [];
  if (state.builtMesh) {
    state.scene.remove(state.builtMesh.group);
    state.builtMesh.dispose();
    state.builtMesh = null;
  }
  state.pickables = [];
}

const frameBox = new Box3();
const frameSphere = new Sphere();
const frameCentre = new Vector3();

/**
 * Positions the orbit camera so the whole track is visible, then centres
 * OrbitControls on the track's bounding-sphere centre. For perspective
 * the distance is derived from the FOV; for ortho the frustum is sized
 * directly to the bounding-sphere diameter.
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

  // Pick the 45°/35° octant for a three-quarters home view.
  const dir = new Vector3(1, 0.55, 1).normalize();

  if (state.camera instanceof PerspectiveCamera) {
    const fovRad = (state.camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(fovRad / 2)) * 1.3;
    state.camera.position.copy(centre).addScaledVector(dir, distance);
    state.camera.lookAt(centre);
    state.controls.minDistance = radius * 0.05;
    state.controls.maxDistance = distance * 4;
  } else {
    // Ortho: place the camera far enough that the track is never behind
    // the near plane, and size the frustum to the bounding-sphere
    // diameter with a 1.3× pad. OrbitControls zoom adjusts .zoom, which
    // we initialise to 1.
    const distance = radius * 10;
    state.camera.position.copy(centre).addScaledVector(dir, distance);
    state.camera.lookAt(centre);
    const halfH = radius * 1.3;
    const rect = state.renderer.domElement;
    const aspect = rect.clientWidth / Math.max(1, rect.clientHeight);
    state.camera.top = halfH;
    state.camera.bottom = -halfH;
    state.camera.left = -halfH * aspect;
    state.camera.right = halfH * aspect;
    state.camera.zoom = 1;
    state.camera.updateProjectionMatrix();
    state.controls.minDistance = distance * 0.1;
    state.controls.maxDistance = distance * 4;
  }
  state.controls.target.copy(centre);
  state.controls.update();
}

/** Swaps the active orbit camera between perspective and ortho. Copies
 *  position/up from the outgoing camera so the viewpoint stays put, then
 *  re-binds OrbitControls to the new camera. */
function switchProjection(state: SceneRefs, target: Projection): void {
  const next: PerspectiveCamera | OrthographicCamera =
    target === 'ortho' ? state.orthoCamera : state.perspCamera;
  if (state.camera === next) return;
  next.position.copy(state.camera.position);
  next.up.copy(state.camera.up);
  next.lookAt(state.controls.target);
  if (next instanceof OrthographicCamera) {
    // Match the visible area at the target plane: halfH ≈ distance *
    // tan(perspFov/2). Use state.perspCamera's fov as the reference.
    const dist = next.position.distanceTo(state.controls.target);
    const halfH = dist * Math.tan((state.perspCamera.fov * Math.PI) / 360);
    const rect = state.renderer.domElement;
    const aspect = rect.clientWidth / Math.max(1, rect.clientHeight);
    next.top = halfH;
    next.bottom = -halfH;
    next.left = -halfH * aspect;
    next.right = halfH * aspect;
    next.zoom = 1;
    next.updateProjectionMatrix();
  }
  state.camera = next;
  state.controls.object = next;
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

function easeInOut(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}

/** Starts a tween of the main camera toward `viewDir` (unit, world-space,
 *  pointing FROM target TO the desired camera position). Distance is kept. */
function startCubeTween(state: SceneRefs, viewDir: Vector3): void {
  const target = state.controls.target;
  const distance = state.camera.position.distanceTo(target);
  const toPos = new Vector3().copy(viewDir).multiplyScalar(distance).add(target);
  // Pick a sensible up: if the target view is (nearly) top-down or
  // bottom-up, use world +Z as up so we don't gimbal-lock; otherwise +Y.
  const upCandidate = Math.abs(viewDir.y) > 0.95 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  state.tween = {
    fromPos: state.camera.position.clone(),
    fromUp: state.camera.up.clone(),
    toPos,
    toUp: upCandidate,
    startMs: performance.now(),
    durationMs: CUBE_TWEEN_MS,
  };
}

/** Rotates the current view by 90° clockwise (dir=+1) or counter-clockwise
 *  (dir=-1) around the current view direction. Used by the cube's rotation
 *  arrow buttons. Rodrigues-simplified: with θ=±π/2, cos=0, sin=±1, so
 *  u' = (k × u) sin + k (k·u). */
function rotateAroundViewDir(state: SceneRefs, dir: 1 | -1): void {
  const k = new Vector3().subVectors(state.controls.target, state.camera.position).normalize();
  const u = state.camera.up;
  const kxu = new Vector3().crossVectors(k, u);
  const kdotu = k.dot(u);
  const out = new Vector3().addScaledVector(kxu, dir).addScaledVector(k, kdotu);
  if (out.lengthSq() < 1e-8) return;
  state.camera.up.copy(out.normalize());
  state.camera.lookAt(state.controls.target);
  state.controls.update();
}

/** Tilts the camera `angleRad` around an axis derived from the current view:
 *  - 'up' / 'down' → rotate around the camera-right axis (tilts vertically).
 *  - 'left' / 'right' → rotate around the world-up axis (orbits around
 *    target horizontally).
 *  Distance preserved; goes through a 400 ms tween.
 */
function startTiltTween(
  state: SceneRefs,
  direction: 'up' | 'down' | 'left' | 'right',
  angleRad: number,
): void {
  const target = state.controls.target;
  const fromPos = state.camera.position.clone();
  const offset = new Vector3().subVectors(fromPos, target);
  const distance = offset.length();
  if (distance < 1e-6) return;
  const forward = offset.clone().multiplyScalar(-1 / distance);
  const right = new Vector3().crossVectors(forward, state.camera.up).normalize();

  let axis: Vector3;
  let sign: number;
  if (direction === 'up' || direction === 'down') {
    axis = right;
    sign = direction === 'up' ? -1 : 1;
  } else {
    // Orbit around world-up for horizontal tilts — feels more natural than
    // orbiting around the camera-local up axis.
    axis = new Vector3(0, 1, 0);
    sign = direction === 'right' ? -1 : 1;
  }
  const rotated = offset.clone().applyAxisAngle(axis, sign * angleRad);
  const toPos = rotated.add(target);
  state.tween = {
    fromPos,
    fromUp: state.camera.up.clone(),
    toPos,
    toUp: state.camera.up.clone(),
    startMs: performance.now(),
    durationMs: CUBE_TWEEN_MS,
  };
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

/** Builds the tubular mesh, adds it to the scene, and records pickables. */
function buildTubularScene(
  state: SceneRefs,
  track: TrackStream,
  sectionColors: readonly string[] | undefined,
  selectedIndex: number | null,
  heartOffset: number,
): void {
  const built = buildTubularTrackMesh(track, sectionColors, selectedIndex, { heartOffset });
  state.scene.add(built.group);
  state.builtMesh = built;
  for (const p of built.pickables) {
    state.pickables.push({ sectionIndex: p.sectionIndex, obj: p.mesh });
  }
}

/** Builds the fast ribbon overlay (three lines per section) — kept as an
 *  optional debug/overview style after the tubular mesh landed at M7. */
function buildRibbonScene(
  state: SceneRefs,
  track: TrackStream,
  sectionColors: readonly string[] | undefined,
  selectedIndex: number | null,
  heartOffset: number,
): void {
  const n = track.nodeCount;
  const railLeft = new Float32Array(n * 3);
  const railRight = new Float32Array(n * 3);
  // Ribbon rails sit `heartOffset` below the heart line along norm so
  // the ribbon matches the tubular-mesh placement — rider's heart is
  // well above the rails in both modes.
  for (let i = 0; i < n; i += 1) {
    const px = track.positions[i * 3]!;
    const py = track.positions[i * 3 + 1]!;
    const pz = track.positions[i * 3 + 2]!;
    const lx = track.lateralAxis[i * 3]!;
    const ly = track.lateralAxis[i * 3 + 1]!;
    const lz = track.lateralAxis[i * 3 + 2]!;
    // norm = lat × dir; we need dir from neighbours.
    const ni = Math.min(i + 1, n - 1);
    const pi = Math.max(i - 1, 0);
    const dx = track.positions[ni * 3]! - track.positions[pi * 3]!;
    const dy = track.positions[ni * 3 + 1]! - track.positions[pi * 3 + 1]!;
    const dz = track.positions[ni * 3 + 2]! - track.positions[pi * 3 + 2]!;
    const dlen = Math.hypot(dx, dy, dz) || 1;
    const dxn = dx / dlen;
    const dyn = dy / dlen;
    const dzn = dz / dlen;
    const nx = ly * dzn - lz * dyn;
    const ny = lz * dxn - lx * dzn;
    const nz = lx * dyn - ly * dxn;
    const bx = px - nx * heartOffset;
    const by = py - ny * heartOffset;
    const bz = pz - nz * heartOffset;
    railLeft[i * 3] = bx - lx * RAIL_HALF_WIDTH;
    railLeft[i * 3 + 1] = by - ly * RAIL_HALF_WIDTH;
    railLeft[i * 3 + 2] = bz - lz * RAIL_HALF_WIDTH;
    railRight[i * 3] = bx + lx * RAIL_HALF_WIDTH;
    railRight[i * 3 + 1] = by + ly * RAIL_HALF_WIDTH;
    railRight[i * 3 + 2] = bz + lz * RAIL_HALF_WIDTH;
  }

  const centreGeom = new BufferGeometry();
  centreGeom.setAttribute('position', new BufferAttribute(track.positions, 3));
  centreGeom.setDrawRange(0, n);
  const centre = new Line(
    centreGeom,
    new LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.4 }),
  );
  state.scene.add(centre);
  state.lines.push(centre);

  const runs = computeSectionRuns(track.sectionIndex, n);
  for (const run of runs) {
    const baseHex = colorHexToInt(
      sectionColors?.[run.sectionIndex] ?? sectionColor(run.sectionIndex),
    );
    const isSelected = run.sectionIndex === selectedIndex;
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
      state.pickables.push({ sectionIndex: run.sectionIndex, obj: line });
    }
  }

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
}

export function Viewport({
  tracks,
  sectionColors,
  selectedSectionIndex,
  cameraMode,
  fitEpoch,
  resetEpoch,
  cubeLabels,
  onSelectSection,
  renderStyle,
  onHome,
  projection,
  bezierHandles,
  onBezierHandleChange,
  showHeartline,
  heartOffset,
  skyDataUri,
  floorDataUri,
  floorColor,
  floorVisible,
  floorTileMeters,
}: ViewportProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<SceneRefs | null>(null);
  const [webglSupported] = useState(hasWebGL);
  // Snapshot the latest onSelectSection in a ref so pointer handlers don't
  // need to re-bind every render.
  const onSelectRef = useRef<typeof onSelectSection>(onSelectSection);
  onSelectRef.current = onSelectSection;
  const onBezierChangeRef = useRef<typeof onBezierHandleChange>(onBezierHandleChange);
  onBezierChangeRef.current = onBezierHandleChange;
  // Remember what epoch we last framed at so the same epoch doesn't refire
  // on every re-render. `null` means "haven't fit yet"; the first non-empty
  // tracks render forces a fit regardless of epoch.
  const lastFitEpoch = useRef<number | null>(null);
  const lastResetEpoch = useRef<number | null>(null);

  useEffect(() => {
    if (!webglSupported) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    // Let the canvas fill its flex container. Without this, `setSize(w, h,
    // false)` only updates the drawing buffer; the CSS box stays fixed at
    // the initial size and subsequent layout changes (folded panels,
    // orientation flips) leave the canvas the old size.
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.append(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color(0x0b0b0b);

    const grid = new GridHelper(200, 40, 0x333333, 0x222222);
    scene.add(grid);

    // A wide invisible plane that only renders cast shadows. Keeps the
    // grid visible (no solid ground competing for attention) while giving
    // the rail/crosstie meshes somewhere to project their shadows.
    const ground = new Mesh(
      new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
      new ShadowMaterial({ opacity: 0.35 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    // NB: state.ground is assigned below so the env effects can mutate it.

    const axes = new AxesHelper(5);
    // Lift the axes slightly above the ground plane and disable depth
    // testing so it never z-fights with the shadow-receiving plane at y=0.
    axes.position.y = 0.01;
    (axes.material as LineBasicMaterial).depthTest = false;
    (axes.material as LineBasicMaterial).depthWrite = false;
    axes.renderOrder = 1;
    scene.add(axes);

    scene.add(new AmbientLight(0xffffff, 0.55));
    const dir = new DirectionalLight(0xffffff, 0.95);
    dir.position.set(40, 80, 30);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -80;
    dir.shadow.camera.right = 80;
    dir.shadow.camera.top = 80;
    dir.shadow.camera.bottom = -80;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 300;
    dir.shadow.bias = -0.0005;
    scene.add(dir);

    const perspCamera = new PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 2000);
    perspCamera.position.set(30, 20, 30);
    perspCamera.lookAt(0, 5, 0);
    // Initial ortho frustum matches the perspective view at z ≈ target
    // plane; ResizeObserver and frameCamera re-derive exact bounds from
    // the current track size.
    const orthoAspect = host.clientWidth / Math.max(1, host.clientHeight);
    const orthoHalf = 25; // default visible half-height in world units
    const orthoCamera = new OrthographicCamera(
      -orthoHalf * orthoAspect,
      orthoHalf * orthoAspect,
      orthoHalf,
      -orthoHalf,
      0.1,
      2000,
    );
    orthoCamera.position.copy(perspCamera.position);
    orthoCamera.up.copy(perspCamera.up);
    orthoCamera.lookAt(0, 5, 0);

    const camera: PerspectiveCamera | OrthographicCamera = perspCamera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 5, 0);
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.9;

    const cube = createViewCube(DEFAULT_CUBE_LABELS);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode('translate');
    transform.setSpace('world');
    transform.size = 0.7;
    // Newer Three.js exposes the visual via getHelper(); the control
    // object itself is an EventDispatcher, not a scene node.
    const transformHelper = transform.getHelper();
    scene.add(transformHelper);

    const state: SceneRefs = {
      renderer,
      scene,
      camera,
      perspCamera,
      orthoCamera,
      controls,
      lines: [],
      builtMesh: null,
      heartlineObj: null,
      pickables: [],
      frame: 0,
      framedTrack: null,
      cameraMode: 'orbit',
      povTime: 0,
      lastFrameMs: performance.now(),
      cube,
      tween: null,
      pointerDown: null,
      transform,
      handleMeshes: [],
      activeHandleIndex: null,
      ground,
      skyTexture: null,
      floorTexture: null,
      ro: new ResizeObserver(() => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        renderer.setSize(w, h, false);
        perspCamera.aspect = w / Math.max(1, h);
        perspCamera.updateProjectionMatrix();
        // Preserve the ortho's current vertical half-size (top - bottom)
        // while reshaping horizontally to match the new aspect.
        const halfH = (orthoCamera.top - orthoCamera.bottom) / 2;
        const aspect = w / Math.max(1, h);
        orthoCamera.left = -halfH * aspect;
        orthoCamera.right = halfH * aspect;
        orthoCamera.updateProjectionMatrix();
      }),
    };
    state.ro.observe(host);
    refs.current = state;

    // TransformControls events: disable OrbitControls while dragging a
    // handle, and commit the new position on release.
    transform.addEventListener('dragging-changed', (ev) => {
      const dragging = Boolean((ev as unknown as { value: boolean }).value);
      state.controls.enabled = !dragging;
      if (!dragging && state.activeHandleIndex !== null) {
        const mesh = state.handleMeshes[state.activeHandleIndex];
        if (mesh) {
          const p = mesh.position;
          onBezierChangeRef.current?.(state.activeHandleIndex as 0 | 1 | 2 | 3, [p.x, p.y, p.z]);
        }
      }
    });

    // Pointer handlers: distinguish click-to-pick vs. orbit-drag by total
    // pointer travel and elapsed time.
    const onPointerDown = (ev: PointerEvent): void => {
      state.pointerDown = { x: ev.clientX, y: ev.clientY, time: performance.now() };
    };
    const onPointerUp = (ev: PointerEvent): void => {
      const down = state.pointerDown;
      state.pointerDown = null;
      if (!down) return;
      const dx = ev.clientX - down.x;
      const dy = ev.clientY - down.y;
      const dist = Math.hypot(dx, dy);
      if (dist > CLICK_MOVE_PX) return;
      if (performance.now() - down.time > CLICK_MAX_MS) return;
      handleClick(ev);
    };
    const handleClick = (ev: PointerEvent): void => {
      const rect = renderer.domElement.getBoundingClientRect();
      const pxX = ev.clientX - rect.left;
      const pxY = ev.clientY - rect.top;
      const hostW = renderer.domElement.clientWidth;
      const hostH = renderer.domElement.clientHeight;

      // 1. Cube pick has priority — it sits in the top-right rect.
      const cubeHit = state.cube.pick(pxX, pxY, hostW, hostH);
      if (cubeHit) {
        startCubeTween(state, cubeHit.viewDir);
        return;
      }
      if (state.cube.hitTestRect(pxX, pxY, hostW, hostH)) return;

      // 2. Bezier-handle pick. If the click hits one of the visible
      //    handle spheres, attach TransformControls to it and skip the
      //    rail raycast. Handle drag is detected by `dragging-changed`
      //    on the transform controls, so a click that doesn't turn into
      //    a drag simply re-attaches the gizmo.
      if (state.handleMeshes.length > 0) {
        const ndcH = new Vector2((pxX / hostW) * 2 - 1, -((pxY / hostH) * 2 - 1));
        const rcH = new Raycaster();
        rcH.setFromCamera(ndcH, state.camera);
        const handleHits = rcH.intersectObjects(state.handleMeshes, false);
        const hh = handleHits[0];
        if (hh) {
          const hi = state.handleMeshes.indexOf(hh.object as Mesh);
          if (hi >= 0) {
            state.activeHandleIndex = hi;
            state.transform?.attach(hh.object);
            return;
          }
        }
      }

      // 2. Otherwise, raycast whichever geometry is currently active
      //    (tubular meshes or ribbon lines).
      const ndc = new Vector2((pxX / hostW) * 2 - 1, -((pxY / hostH) * 2 - 1));
      const raycaster = new Raycaster();
      raycaster.params.Line = { threshold: 0.4 };
      raycaster.setFromCamera(ndc, state.camera);
      const pickObjects = state.pickables.map((p) => p.obj);
      const hits = raycaster.intersectObjects(pickObjects, false);
      const first = hits[0];
      // Clicking on empty space or switching sections detaches the gizmo.
      state.transform?.detach();
      state.activeHandleIndex = null;
      if (!first) {
        onSelectRef.current?.(null);
        return;
      }
      const pickable = state.pickables.find((p) => p.obj === first.object);
      if (pickable) onSelectRef.current?.(pickable.sectionIndex);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const loop = (now: number): void => {
      const dt = Math.max(0, (now - state.lastFrameMs) / 1000);
      state.lastFrameMs = now;

      // Camera tween (from ViewCube click) takes priority over manual orbit.
      if (state.tween) {
        const u = Math.min(1, (now - state.tween.startMs) / state.tween.durationMs);
        const e = easeInOut(u);
        state.camera.position.lerpVectors(state.tween.fromPos, state.tween.toPos, e);
        state.camera.up.lerpVectors(state.tween.fromUp, state.tween.toUp, e).normalize();
        state.camera.lookAt(state.controls.target);
        if (u >= 1) state.tween = null;
      } else if (state.cameraMode === 'pov') {
        advancePov(state, dt);
      } else {
        state.controls.update();
      }
      state.renderer.render(state.scene, state.camera);
      // Overlay cube on top. Only visible in orbit mode — in POV the cube
      // would fight for attention with the ride-through view.
      if (state.cameraMode !== 'pov') {
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        state.cube.syncToMainCamera(state.camera, state.controls.target);
        state.cube.render(state.renderer, w, h);
      }
      state.frame = requestAnimationFrame(loop);
    };
    state.frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(state.frame);
      state.ro.disconnect();
      state.controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      disposeHandleMeshes(state);
      state.transform?.detach();
      scene.remove(transformHelper);
      state.transform?.dispose();
      if (state.heartlineObj) {
        for (const l of state.heartlineObj) {
          state.scene.remove(l);
          l.geometry.dispose();
          (l.material as LineBasicMaterial).dispose();
        }
        state.heartlineObj = null;
      }
      disposeTrackGeometry(state);
      state.cube.dispose();
      state.skyTexture?.dispose();
      state.floorTexture?.dispose();
      (state.ground.material as ShadowMaterial | MeshStandardMaterial).dispose();
      state.ground.geometry.dispose();
      scene.remove(state.ground);
      renderer.dispose();
      renderer.domElement.remove();
      refs.current = null;
    };
  }, [webglSupported]);

  // Rebuild the cube when localized labels change (language switch).
  useEffect(() => {
    const state = refs.current;
    if (!state || !cubeLabels) return;
    state.cube.dispose();
    state.cube = createViewCube(cubeLabels);
  }, [cubeLabels]);

  // Apply sky-background texture on change. `null` reverts to the default
  // dark background. Equirectangular mapping so standard panoramic HDR /
  // JPG skyboxes work out of the box.
  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    // Drop any previous texture first.
    if (state.skyTexture) {
      state.skyTexture.dispose();
      state.skyTexture = null;
    }
    if (!skyDataUri) {
      state.scene.background = new Color(0x0b0b0b);
      state.scene.environment = null;
      return;
    }
    new TextureLoader().load(skyDataUri, (tex) => {
      tex.mapping = EquirectangularReflectionMapping;
      tex.colorSpace = SRGBColorSpace;
      // The effect may have already swapped to another sky while the load
      // was in flight — defend by checking the current ref.
      const cur = refs.current;
      if (!cur) {
        tex.dispose();
        return;
      }
      cur.skyTexture = tex;
      cur.scene.background = tex;
      cur.scene.environment = tex;
    });
  }, [skyDataUri]);

  // Apply floor material on change. When a floor image is supplied it
  // becomes a repeating PBR texture on the ground plane; otherwise the
  // ground uses a solid colour (or reverts to the default shadow-only
  // transparent material when `floorColor` is empty).
  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    const g = state.ground;
    const oldMat = g.material as ShadowMaterial | MeshStandardMaterial;
    if (state.floorTexture) {
      state.floorTexture.dispose();
      state.floorTexture = null;
    }
    if (floorDataUri) {
      new TextureLoader().load(floorDataUri, (tex) => {
        tex.wrapS = RepeatWrapping;
        tex.wrapT = RepeatWrapping;
        const tile = floorTileMeters && floorTileMeters > 0 ? floorTileMeters : 10;
        const repeat = GROUND_SIZE_M / tile;
        tex.repeat.set(repeat, repeat);
        tex.colorSpace = SRGBColorSpace;
        const cur = refs.current;
        if (!cur) {
          tex.dispose();
          return;
        }
        cur.floorTexture = tex;
        cur.ground.material = new MeshStandardMaterial({
          map: tex,
          roughness: 0.85,
          metalness: 0.05,
        });
        oldMat.dispose();
      });
      return;
    }
    // No floor image → solid colour (or transparent shadow-only if empty).
    if (floorColor && floorColor !== '') {
      g.material = new MeshStandardMaterial({
        color: new Color(floorColor),
        roughness: 0.95,
        metalness: 0.0,
      });
      oldMat.dispose();
    } else if (!(oldMat instanceof ShadowMaterial)) {
      g.material = new ShadowMaterial({ opacity: 0.35 });
      oldMat.dispose();
    }
  }, [floorDataUri, floorColor, floorTileMeters]);

  // Live update of the floor tile scale without reloading the texture.
  // Runs independently so dragging the slider doesn't trigger the material
  // effect's full dispose-and-rebuild.
  useEffect(() => {
    const state = refs.current;
    if (!state?.floorTexture) return;
    const tile = floorTileMeters && floorTileMeters > 0 ? floorTileMeters : 10;
    const repeat = GROUND_SIZE_M / tile;
    state.floorTexture.repeat.set(repeat, repeat);
    state.floorTexture.needsUpdate = true;
  }, [floorTileMeters]);

  // Toggle ground plane visibility entirely. `floorVisible = false`
  // hides the shadow-receiving plane so the scene looks like it's
  // floating in open space (useful with a sky image that already
  // supplies its own ground).
  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    state.ground.visible = floorVisible !== false;
  }, [floorVisible]);

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
      // POV is always perspective — parallel projection first-person is
      // confusing. Switch active camera for the duration of POV mode.
      state.camera = state.perspCamera;
      state.controls.object = state.perspCamera;
      state.povTime = 0;
    } else {
      // Return to whichever projection the user has selected in orbit.
      switchProjection(state, projection === 'ortho' ? 'ortho' : 'perspective');
      if (tracks[0]) frameCamera(state, tracks[0]);
    }
  }, [cameraMode, tracks, projection]);

  // Switch projection on prop change (only meaningful in orbit mode).
  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    if (state.cameraMode === 'pov') return; // POV stays perspective
    switchProjection(state, projection === 'ortho' ? 'ortho' : 'perspective');
  }, [projection]);

  // Build / refresh Bezier handle meshes whenever the selected section's
  // control points change. Re-uses TransformControls — just moves the
  // proxy sphere positions and re-attaches if the user was mid-edit.
  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    // Remember which handle was active so we can re-attach after rebuild.
    const previouslyActive = state.activeHandleIndex;
    state.transform?.detach();
    disposeHandleMeshes(state);
    if (!bezierHandles || cameraMode === 'pov') {
      state.activeHandleIndex = null;
      return;
    }
    const geom = new SphereGeometry(0.25, 12, 8);
    // Endpoints (0, 3) are orange; interior handles (1, 2) are amber —
    // the visual distinction makes it obvious which ones change the
    // section's start/end pose vs. the tangent length.
    const endColor = 0xff9f5c;
    const tangentColor = 0xffd24f;
    bezierHandles.forEach((pos, i) => {
      const mat = new MeshBasicMaterial({
        color: i === 0 || i === 3 ? endColor : tangentColor,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      });
      const sphere = new Mesh(geom, mat);
      sphere.position.set(pos[0], pos[1], pos[2]);
      sphere.renderOrder = 999; // render on top of rails
      state.scene.add(sphere);
      state.handleMeshes.push(sphere);
    });
    // Re-attach if the user was mid-edit on a specific handle.
    const recall = previouslyActive !== null ? state.handleMeshes[previouslyActive] : undefined;
    if (recall && state.transform) {
      state.transform.attach(recall);
      state.activeHandleIndex = previouslyActive;
    } else {
      state.activeHandleIndex = null;
    }
  }, [bezierHandles, cameraMode]);

  // Imperative "reset view" — bumped by the App's Reset button. Re-runs the
  // full framing math so the user can bail out of a weird orbit.
  useEffect(() => {
    const state = refs.current;
    if (!state || resetEpoch === undefined) return;
    if (lastResetEpoch.current === resetEpoch) return;
    lastResetEpoch.current = resetEpoch;
    const first = tracks[0];
    if (first) frameCamera(state, first);
  }, [resetEpoch, tracks]);

  // Swap the rendered lines whenever recompute hands us new node streams,
  // or the user selects a different section (highlight).
  useEffect(() => {
    const state = refs.current;
    if (!state) return;

    disposeTrackGeometry(state);

    if (tracks.length === 0) {
      state.framedTrack = null;
      return;
    }
    const first = tracks[0];
    if (!first || first.nodeCount === 0) return;

    // Auto-fit policy: only on the explicit `fitEpoch` bump from the app.
    // Parameter edits trigger a new recompute (new TrackStream reference) but
    // the epoch doesn't change, so the camera stays where the user left it.
    // A fresh project / Load Demo / Fit button press bumps the epoch to
    // request a reframe.
    const shouldFitOnFirstRender = state.framedTrack === null;
    const epochChanged = fitEpoch !== undefined && fitEpoch !== lastFitEpoch.current;
    if (shouldFitOnFirstRender || epochChanged) {
      frameCamera(state, first);
      if (fitEpoch !== undefined) lastFitEpoch.current = fitEpoch;
    }
    state.framedTrack = first;

    const style: RenderStyle = renderStyle ?? 'tubular';
    const h = heartOffset ?? 1.1;
    if (style === 'tubular') {
      buildTubularScene(state, first, sectionColors, selectedSectionIndex ?? null, h);
    } else {
      buildRibbonScene(state, first, sectionColors, selectedSectionIndex ?? null, h);
    }
  }, [tracks, sectionColors, selectedSectionIndex, renderStyle, heartOffset]);

  // Heartline overlay lives in its own effect. Previously it shared deps
  // with the rails rebuild, and toggling it caused a full mesh dispose
  // which visually flashed and (on first run of the heartline branch)
  // could re-frame the camera. Owning its own objects keeps the toggle
  // cheap.
  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    // Clear any previous heartline overlay.
    if (state.heartlineObj) {
      for (const l of state.heartlineObj) {
        state.scene.remove(l);
        l.geometry.dispose();
        (l.material as LineBasicMaterial).dispose();
      }
      state.heartlineObj = null;
    }
    if (!showHeartline) return;
    const first = tracks[0];
    if (!first || first.nodeCount < 2) return;
    // Narrow twin ribbon (±0.08 m lateral around the heart line) so the
    // banking rolls with the track and stays clearly narrower than the
    // rails (which are at ±0.35 m by default).
    const n = first.nodeCount;
    const ribbonHalf = 0.08;
    const leftVerts = new Float32Array(n * 3);
    const rightVerts = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const px = first.positions[i * 3]!;
      const py = first.positions[i * 3 + 1]!;
      const pz = first.positions[i * 3 + 2]!;
      const lx = first.lateralAxis[i * 3]!;
      const ly = first.lateralAxis[i * 3 + 1]!;
      const lz = first.lateralAxis[i * 3 + 2]!;
      leftVerts[i * 3] = px - lx * ribbonHalf;
      leftVerts[i * 3 + 1] = py - ly * ribbonHalf;
      leftVerts[i * 3 + 2] = pz - lz * ribbonHalf;
      rightVerts[i * 3] = px + lx * ribbonHalf;
      rightVerts[i * 3 + 1] = py + ly * ribbonHalf;
      rightVerts[i * 3 + 2] = pz + lz * ribbonHalf;
    }
    const objs: Line[] = [];
    for (const verts of [leftVerts, rightVerts]) {
      const geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(verts, 3));
      const line = new Line(
        geom,
        new LineBasicMaterial({ color: 0xff6b9d, transparent: true, opacity: 0.9 }),
      );
      line.renderOrder = 2;
      state.scene.add(line);
      objs.push(line);
    }
    state.heartlineObj = objs;
  }, [tracks, showHeartline]);

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

  const rotate = (dir: 1 | -1): void => {
    const state = refs.current;
    if (state) rotateAroundViewDir(state, dir);
  };
  const tilt = (direction: 'up' | 'down' | 'left' | 'right'): void => {
    const state = refs.current;
    if (state) startTiltTween(state, direction, Math.PI / 4);
  };
  const goHome = (): void => onHome?.();

  const cubeHidden = cameraMode === 'pov';
  const labels = cubeLabels ?? DEFAULT_CUBE_LABELS;

  // Must match SIZE_PX / MARGIN_PX in view-cube.ts. The cube itself is
  // drawn by WebGL into a scissored region at (right: CUBE_INSET, top:
  // CUBE_INSET) of size CUBE_SIZE. The DOM arrow ring wraps tight around
  // that rectangle, leaving ARROW_GUTTER px for the tilt arrows inside.
  const CUBE_SIZE = 100;
  const CUBE_INSET = 34;
  const ARROW_GUTTER = 22;
  const RING_SIZE = CUBE_SIZE + ARROW_GUTTER * 2;
  const RING_TOP = CUBE_INSET - ARROW_GUTTER;
  const RING_RIGHT = CUBE_INSET - ARROW_GUTTER;

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="viewport"
      className="relative h-full w-full select-none bg-surface-0"
      style={{ touchAction: 'none' }}
    >
      {/* FreeCAD-style cube widget: the WebGL-drawn cube lives inside this
          rect (via scissor in the render loop); the DOM buttons here sit
          on top of the canvas, outside the cube, and don't block cube
          clicks because they're positioned beyond its 120×120 region. */}
      {!cubeHidden && (
        <div
          aria-hidden="false"
          className="pointer-events-none absolute z-10"
          style={{
            width: RING_SIZE,
            height: RING_SIZE,
            top: RING_TOP,
            right: RING_RIGHT,
          }}
        >
          {/* In-plane rotation arrows in the top corners of the ring.
              Rotate the camera 90° around the current forward axis. Using
              SVG (not Unicode ↻/↺) so they render consistently across
              fonts. */}
          <ArrowButton
            svg={ROTATE_CCW_SVG}
            label={labels.rotateCcw ?? 'Rotate counter-clockwise'}
            style={{ top: 0, left: 0 }}
            onClick={() => rotate(-1)}
          />
          <ArrowButton
            svg={ROTATE_CW_SVG}
            label={labels.rotateCw ?? 'Rotate clockwise'}
            style={{ top: 0, right: 0 }}
            onClick={() => rotate(1)}
          />
          {/* Four tilt-triangle arrows on each side of the cube, tucked
              into the gutter strips so the cube stays fully clickable.
              Corner positions are reserved for rotate/home. */}
          <ArrowButton
            glyph="▲"
            label={labels.tiltUp ?? 'Tilt up'}
            style={{ top: 1, left: '50%', transform: 'translate(-50%, 0)' }}
            onClick={() => tilt('up')}
          />
          <ArrowButton
            glyph="▼"
            label={labels.tiltDown ?? 'Tilt down'}
            style={{ bottom: 1, left: '50%', transform: 'translate(-50%, 0)' }}
            onClick={() => tilt('down')}
          />
          <ArrowButton
            glyph="◀"
            label={labels.tiltLeft ?? 'Tilt left'}
            style={{ left: 1, top: '50%', transform: 'translate(0, -50%)' }}
            onClick={() => tilt('left')}
          />
          <ArrowButton
            glyph="▶"
            label={labels.tiltRight ?? 'Tilt right'}
            style={{ right: 1, top: '50%', transform: 'translate(0, -50%)' }}
            onClick={() => tilt('right')}
          />
          {/* Home button in the bottom-right corner of the ring. Returns
              the camera to the default orbit pose. */}
          <ArrowButton
            glyph="⌂"
            label={labels.home ?? 'Home view'}
            style={{ bottom: 1, right: 1 }}
            onClick={goHome}
          />
        </div>
      )}
    </div>
  );
}

interface ArrowButtonProps {
  /** Unicode glyph. Mutually exclusive with `svg`. */
  readonly glyph?: string;
  /** Inline SVG body. Mutually exclusive with `glyph`. */
  readonly svg?: string;
  readonly label: string;
  readonly style: React.CSSProperties;
  readonly onClick: () => void;
}
function ArrowButton({ glyph, svg, label, style, onClick }: ArrowButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded text-[13px] leading-none text-neutral-200 hover:bg-white/20 focus-visible:outline-none focus-visible:ring focus-visible:ring-white/30"
      style={{ ...style, backgroundColor: 'rgba(30, 30, 30, 0.55)' }}
    >
      {svg ? (
        <svg
          viewBox="0 0 20 20"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        glyph
      )}
    </button>
  );
}

// 270° arc with an arrowhead at the end — "rotate counter-clockwise".
const ROTATE_CCW_SVG = `<path d="M15 5 A 7 7 0 1 0 17 13" /><polyline points="14,10 17,13 20,10" />`;
// Mirrored: "rotate clockwise".
const ROTATE_CW_SVG = `<path d="M5 5 A 7 7 0 1 1 3 13" /><polyline points="6,10 3,13 0,10" />`;
