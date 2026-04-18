// SPDX-License-Identifier: AGPL-3.0-only

import { type TrackStream } from '@roller-coaster-designer/worker';
import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
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
  TOUCH,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface ViewportProps {
  readonly tracks: readonly TrackStream[];
}

interface SceneRefs {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  lines: Line[];
  ro: ResizeObserver;
  frame: number;
}

// Half-gauge used when drawing rails off the centre path. FVD++ has
// style-specific gauges; for M4.5 a single default is enough to make banking
// visible. M7's track-mesh work replaces this with real profile geometry.
const RAIL_HALF_WIDTH = 0.3;
const CROSSTIE_EVERY_N_NODES = 120; // ~0.12 s at 1000 Hz

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

export function Viewport({ tracks }: ViewportProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<SceneRefs | null>(null);
  const [webglSupported] = useState(hasWebGL);

  // One-time Three.js setup. The viewport doesn't remount on project changes;
  // only the line geometry is swapped.
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
    // Spec §6.4 tablet scheme: one-finger orbit, two-finger pan + pinch zoom.
    // Three's DOLLY_PAN on two fingers bundles pan and pinch on the same
    // gesture, which matches how trackpad users expect gestures to compose.
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    // Tuned for finger input — OrbitControls' defaults are mouse-paced.
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.9;

    const state: SceneRefs = {
      renderer,
      scene,
      camera,
      controls,
      lines: [],
      frame: 0,
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

    const loop = (): void => {
      state.controls.update();
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

  // Swap the rendered lines whenever recompute hands us new node streams.
  useEffect(() => {
    const state = refs.current;
    if (!state) return;

    disposeLines(state);

    if (tracks.length === 0) return;

    const first = tracks[0];
    if (!first || first.nodeCount === 0) return;

    // Centreline: the classic polyline from M2. Blue so it stays visible
    // even when the rails blend with the grid.
    const centreGeom = new BufferGeometry();
    centreGeom.setAttribute('position', new BufferAttribute(first.positions, 3));
    centreGeom.setDrawRange(0, first.nodeCount);
    const centreMat = new LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.55 });
    const centre = new Line(centreGeom, centreMat);
    state.scene.add(centre);
    state.lines.push(centre);

    // Rails: centre ± RAIL_HALF_WIDTH along the lateral axis. When the track
    // banks, lat rotates around the forward direction, so the two rails
    // describe the bank angle directly. This is what makes banking visible
    // without waiting for M7's full track-mesh work.
    const n = first.nodeCount;
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
    const leftGeom = new BufferGeometry();
    leftGeom.setAttribute('position', new BufferAttribute(railLeft, 3));
    leftGeom.setDrawRange(0, n);
    const rightGeom = new BufferGeometry();
    rightGeom.setAttribute('position', new BufferAttribute(railRight, 3));
    rightGeom.setDrawRange(0, n);
    const railMat = new LineBasicMaterial({ color: 0xffffff });
    state.lines.push(new Line(leftGeom, railMat));
    state.lines.push(new Line(rightGeom, railMat));
    state.scene.add(state.lines[1]!);
    state.scene.add(state.lines[2]!);

    // Cross-ties between left and right rails every few nodes. LineSegments
    // takes pairs of vertices; emit one pair per sampled node.
    const ties: number[] = [];
    for (let i = 0; i < n; i += CROSSTIE_EVERY_N_NODES) {
      ties.push(railLeft[i * 3]!, railLeft[i * 3 + 1]!, railLeft[i * 3 + 2]!);
      ties.push(railRight[i * 3]!, railRight[i * 3 + 1]!, railRight[i * 3 + 2]!);
    }
    if (ties.length > 0) {
      const tiesGeom = new BufferGeometry();
      tiesGeom.setAttribute('position', new BufferAttribute(new Float32Array(ties), 3));
      const tiesMat = new LineBasicMaterial({ color: 0x888888 });
      const tiesLine = new LineSegments(tiesGeom, tiesMat);
      state.scene.add(tiesLine);
      state.lines.push(tiesLine as unknown as Line);
    }
  }, [tracks]);

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
      // Disables the browser's default touch behaviours on the canvas so
      // one-finger drags don't scroll the page and two-finger pinches don't
      // zoom the page. Without this OrbitControls still receives events, but
      // the page itself rides along behind the gesture. Spec §6.4.
      style={{ touchAction: 'none' }}
    />
  );
}
