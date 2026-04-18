// SPDX-License-Identifier: AGPL-3.0-only

import {
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';

export interface ViewCubeLabels {
  readonly top: string;
  readonly bottom: string;
  readonly front: string;
  readonly back: string;
  readonly left: string;
  readonly right: string;
  /** Aria labels for the in-plane rotation buttons anchored to the cube. */
  readonly rotateCw?: string;
  readonly rotateCcw?: string;
}

/** Where along each axis the hit falls. */
type AxisBand = 'neg' | 'mid' | 'pos';

/** Region the user clicked: 1 non-mid axis = face, 2 = edge, 3 = corner. */
interface CubeHit {
  /** Direction the main camera should face *from* (world space), pointing
   *  from `target` to `camera`. Length 1. */
  readonly viewDir: Vector3;
}

const SIZE_PX = 110;
const MARGIN_PX = 12;
const FACE_THRESHOLD = 0.3; // local-coord magnitude for "near the edge"

function makeFaceTexture(label: string, accent: string): CanvasTexture {
  const dim = 128;
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(0, 0, dim, dim);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, dim - 6, dim - 6);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.toUpperCase(), dim / 2, dim / 2 + 2);
  const tex = new CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

export interface ViewCube {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Sync cube orientation to reflect the main camera's view direction. */
  syncToMainCamera(mainCam: PerspectiveCamera, target: Vector3): void;
  /** Render the cube into the top-right corner of the main canvas. */
  render(renderer: WebGLRenderer, hostW: number, hostH: number): void;
  /**
   * Returns the pointer-picked cube region if the pointer lies inside the
   * cube's overlay rectangle and hits the cube. Pointer coords are
   * client-space px relative to the canvas top-left.
   */
  pick(pxX: number, pxY: number, hostW: number, hostH: number): CubeHit | null;
  /** Is the pointer inside the cube's overlay rectangle? */
  hitTestRect(pxX: number, pxY: number, hostW: number, hostH: number): boolean;
  dispose(): void;
}

export function createViewCube(labels: ViewCubeLabels): ViewCube {
  const scene = new Scene();

  // Six materials ordered by BoxGeometry's face index: +X, -X, +Y, -Y, +Z, -Z.
  // Convention: we treat +Y as up (matches the main scene), +Z as "front"
  // (toward the viewer at the default home orientation), +X as "right".
  const accent = '#5cc8ff';
  const materials = [
    new MeshBasicMaterial({ map: makeFaceTexture(labels.right, accent) }), // +X
    new MeshBasicMaterial({ map: makeFaceTexture(labels.left, accent) }), // -X
    new MeshBasicMaterial({ map: makeFaceTexture(labels.top, accent) }), // +Y
    new MeshBasicMaterial({ map: makeFaceTexture(labels.bottom, accent) }), // -Y
    new MeshBasicMaterial({ map: makeFaceTexture(labels.front, accent) }), // +Z
    new MeshBasicMaterial({ map: makeFaceTexture(labels.back, accent) }), // -Z
  ];
  const cube = new Mesh(new BoxGeometry(1, 1, 1), materials);
  scene.add(cube);

  // Thin edge outlines so corner/edge hits feel targetable.
  const edges = new LineSegments(
    new EdgesGeometry(cube.geometry),
    new LineBasicMaterial({ color: 0x222222, linewidth: 1 }),
  );
  cube.add(edges);

  // Overlay camera: orbiting the cube at a fixed distance. Orientation is
  // updated each frame from the main camera's direction.
  const camera = new PerspectiveCamera(40, 1, 0.1, 10);
  camera.position.set(2, 1.6, 2).setLength(3);
  camera.lookAt(0, 0, 0);

  const raycaster = new Raycaster();
  const ndc = new Vector2();

  function syncToMainCamera(mainCam: PerspectiveCamera, target: Vector3): void {
    // Unit vector FROM the orbit target TO the main camera — that is, the
    // direction the user is currently viewing from. Put the overlay camera
    // at the same relative direction so the cube face nearest the viewer
    // lines up with the main view.
    const dir = new Vector3().subVectors(mainCam.position, target);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.multiplyScalar(1 / len);
    camera.position.copy(dir).multiplyScalar(3);
    camera.up.copy(mainCam.up);
    camera.lookAt(0, 0, 0);
  }

  function rectOrigin(hostW: number, _hostH: number): { x: number; y: number } {
    // Top-right of the canvas; y is from top in client coords.
    return { x: hostW - SIZE_PX - MARGIN_PX, y: MARGIN_PX };
  }

  function render(renderer: WebGLRenderer, hostW: number, hostH: number): void {
    const { x, y } = rectOrigin(hostW, hostH);
    // renderer's scissor/viewport origin is bottom-left; flip y.
    const bottomY = hostH - y - SIZE_PX;
    const prevScissorTest = renderer.getScissorTest();
    renderer.setScissorTest(true);
    renderer.setScissor(x, bottomY, SIZE_PX, SIZE_PX);
    renderer.setViewport(x, bottomY, SIZE_PX, SIZE_PX);
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.setScissorTest(prevScissorTest);
    renderer.setViewport(0, 0, hostW, hostH);
  }

  function hitTestRect(pxX: number, pxY: number, hostW: number, hostH: number): boolean {
    const { x, y } = rectOrigin(hostW, hostH);
    return pxX >= x && pxX <= x + SIZE_PX && pxY >= y && pxY <= y + SIZE_PX;
  }

  function pick(pxX: number, pxY: number, hostW: number, hostH: number): CubeHit | null {
    if (!hitTestRect(pxX, pxY, hostW, hostH)) return null;
    const { x, y } = rectOrigin(hostW, hostH);
    const localX = pxX - x;
    const localY = pxY - y;
    ndc.x = (localX / SIZE_PX) * 2 - 1;
    ndc.y = -((localY / SIZE_PX) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(cube, false);
    const first = hits[0];
    if (!first) return null;
    const point = cube.worldToLocal(first.point.clone());
    const band = (v: number): AxisBand =>
      v > FACE_THRESHOLD ? 'pos' : v < -FACE_THRESHOLD ? 'neg' : 'mid';
    const bx = band(point.x);
    const by = band(point.y);
    const bz = band(point.z);
    // View direction = the unit vector from origin toward the picked region.
    // Treat "mid" as 0. If all bands are mid (shouldn't really happen on a
    // surface hit) fall back to the face normal.
    let dx = bx === 'pos' ? 1 : bx === 'neg' ? -1 : 0;
    let dy = by === 'pos' ? 1 : by === 'neg' ? -1 : 0;
    let dz = bz === 'pos' ? 1 : bz === 'neg' ? -1 : 0;
    if (dx === 0 && dy === 0 && dz === 0) {
      const face = first.face;
      if (!face) return null;
      dx = face.normal.x;
      dy = face.normal.y;
      dz = face.normal.z;
    }
    const viewDir = new Vector3(dx, dy, dz).normalize();
    return { viewDir };
  }

  function dispose(): void {
    cube.geometry.dispose();
    edges.geometry.dispose();
    edges.material.dispose();
    for (const mat of materials) {
      mat.map?.dispose();
      mat.dispose();
    }
  }

  return {
    scene,
    camera,
    syncToMainCamera,
    render,
    pick,
    hitTestRect,
    dispose,
  };
}
