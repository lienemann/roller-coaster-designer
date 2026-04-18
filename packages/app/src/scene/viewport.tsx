// SPDX-License-Identifier: GPL-3.0-only

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
  PerspectiveCamera,
  Scene,
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
  line: Line | null;
  ro: ResizeObserver;
  frame: number;
}

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
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

    const state: SceneRefs = {
      renderer,
      scene,
      camera,
      controls,
      line: null,
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
      if (state.line) {
        state.scene.remove(state.line);
        state.line.geometry.dispose();
        (state.line.material as LineBasicMaterial).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      refs.current = null;
    };
  }, [webglSupported]);

  // Swap the rendered polyline whenever recompute hands us new node streams.
  useEffect(() => {
    const state = refs.current;
    if (!state) return;

    if (state.line) {
      state.scene.remove(state.line);
      state.line.geometry.dispose();
      (state.line.material as LineBasicMaterial).dispose();
      state.line = null;
    }

    if (tracks.length === 0) return;

    // All tracks collapse into one polyline for M2. The spec's node graph
    // view (M15) and per-track rendering split are later concerns.
    const first = tracks[0];
    if (!first || first.nodeCount === 0) return;

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(first.positions, 3));
    geom.setDrawRange(0, first.nodeCount);
    const mat = new LineBasicMaterial({ color: 0x5cc8ff });
    const line = new Line(geom, mat);
    state.scene.add(line);
    state.line = line;
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
      className="relative h-full w-full bg-surface-0"
    />
  );
}
