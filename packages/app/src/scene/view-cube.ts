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
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type OrthographicCamera,
  type WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
  /** Aria labels for the four directional tilt arrows. */
  readonly tiltUp?: string;
  readonly tiltDown?: string;
  readonly tiltLeft?: string;
  readonly tiltRight?: string;
  readonly home?: string;
}

/** Where along each axis the hit falls. */
type AxisBand = 'neg' | 'mid' | 'pos';

/** Region the user clicked: 1 non-mid axis = face, 2 = edge, 3 = corner. */
interface CubeHit {
  /** Direction the main camera should face *from* (world space), pointing
   *  from `target` to `camera`. Length 1. */
  readonly viewDir: Vector3;
}

const SIZE_PX = 120;
const MARGIN_PX = 12;
const FACE_THRESHOLD = 0.3; // local-coord magnitude for "near the edge"

/** FreeCAD-style face texture: light grey chamfered panel, bold dark text,
 *  no accent border. Looks like a physical painted cube face rather than
 *  Fusion's blue highlight treatment. */
function makeFaceTexture(label: string): CanvasTexture {
  const dim = 128;
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, dim);
  grad.addColorStop(0, '#e8e8e8');
  grad.addColorStop(1, '#c7c7c7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, dim, dim);
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, dim - 1, dim - 1);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 26px system-ui, sans-serif';
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
  syncToMainCamera(mainCam: PerspectiveCamera | OrthographicCamera, target: Vector3): void;
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

  // RoundedBoxGeometry gives chamfered corners and edges like FreeCAD's
  // navigation cube — the corner/edge chamfer faces become subtle visual
  // targets. We still rely on local-coordinate band classification for
  // click picking; the rounding is purely cosmetic.
  const faceTextures = [
    makeFaceTexture(labels.right), // +X
    makeFaceTexture(labels.left), // -X
    makeFaceTexture(labels.top), // +Y
    makeFaceTexture(labels.bottom), // -Y
    makeFaceTexture(labels.front), // +Z
    makeFaceTexture(labels.back), // -Z
  ];
  // Single merged material: we can't easily per-face-texture a
  // RoundedBoxGeometry (it has no material groups). Instead we build six
  // small textured plane decals glued to each face of a plain chamfered
  // cube — this keeps the chamfer visible on the cube silhouette.
  const cubeBody = new Mesh(
    new RoundedBoxGeometry(1, 1, 1, 4, 0.1),
    new MeshBasicMaterial({ color: 0xdadada }),
  );
  scene.add(cubeBody);

  const faceDecals: Mesh[] = [];
  // Each entry: [normal, up, right] in world axes. `right` is the
  // viewer's right when looking AT the face from outside (not just world
  // +X); getting this wrong mirrors the face text.
  const faceAxes: [Vector3, Vector3, Vector3][] = [
    [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1)], // +X (Right): viewer right = -Z
    [new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)], // -X (Left): viewer right = +Z
    [new Vector3(0, 1, 0), new Vector3(0, 0, -1), new Vector3(1, 0, 0)], // +Y (Top)
    [new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)], // -Y (Bottom)
    [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)], // +Z (Front): viewer right = +X
    [new Vector3(0, 0, -1), new Vector3(0, 1, 0), new Vector3(-1, 0, 0)], // -Z (Back): viewer right = -X
  ];
  const decalSize = 0.78; // a touch smaller than the cube face so the
  // chamfered edge strip shows through.

  for (let i = 0; i < 6; i += 1) {
    const [normal, up, right] = faceAxes[i]!;
    const mat = new MeshBasicMaterial({
      map: faceTextures[i]!,
      transparent: true,
      depthWrite: false,
    });
    const decal = new Mesh(new PlaneGeometry(decalSize, decalSize), mat);
    // Place decal just outside the rounded-cube face so it renders on top
    // of the chamfer rather than being clipped by it.
    decal.position.copy(normal).multiplyScalar(0.502);
    // Orient: decal's local +Z must point along `normal`; local +Y must
    // align with `up`. makeBasis(right, up, normal) does exactly that.
    decal.matrixAutoUpdate = false;
    decal.matrix.makeBasis(right, up, normal).setPosition(decal.position);
    scene.add(decal);
    faceDecals.push(decal);
  }

  // Thin dark edge outlines so corner/edge hits feel targetable even
  // though the chamfered cube already visualises them.
  const edges = new LineSegments(
    new EdgesGeometry(cubeBody.geometry),
    new LineBasicMaterial({ color: 0x555555, linewidth: 1 }),
  );
  cubeBody.add(edges);

  // Overlay camera: orbiting the cube at a fixed distance. Orientation is
  // updated each frame from the main camera's direction.
  const camera = new PerspectiveCamera(40, 1, 0.1, 10);
  camera.position.set(2, 1.6, 2).setLength(3);
  camera.lookAt(0, 0, 0);

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  // Invisible plain cube used purely for picking — so the chamfer doesn't
  // make face/edge/corner bands hit mid-slopes at odd angles.
  const pickCube = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ visible: false }));
  scene.add(pickCube);

  function syncToMainCamera(
    mainCam: PerspectiveCamera | OrthographicCamera,
    target: Vector3,
  ): void {
    const dir = new Vector3().subVectors(mainCam.position, target);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.multiplyScalar(1 / len);
    camera.position.copy(dir).multiplyScalar(3);
    camera.up.copy(mainCam.up);
    camera.lookAt(0, 0, 0);
  }

  function rectOrigin(hostW: number, _hostH: number): { x: number; y: number } {
    return { x: hostW - SIZE_PX - MARGIN_PX, y: MARGIN_PX };
  }

  function render(renderer: WebGLRenderer, hostW: number, hostH: number): void {
    const { x, y } = rectOrigin(hostW, hostH);
    const bottomY = hostH - y - SIZE_PX;
    const prevScissorTest = renderer.getScissorTest();
    const prevAutoClearColor = renderer.autoClearColor;
    renderer.setScissorTest(true);
    renderer.setScissor(x, bottomY, SIZE_PX, SIZE_PX);
    renderer.setViewport(x, bottomY, SIZE_PX, SIZE_PX);
    renderer.clearDepth();
    // Don't wipe the main scene's pixels under the cube — just draw the
    // cube on top, so the track/grid/sky show through the chamfered gaps.
    renderer.autoClearColor = false;
    renderer.render(scene, camera);
    renderer.autoClearColor = prevAutoClearColor;
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
    const hits = raycaster.intersectObject(pickCube, false);
    const first = hits[0];
    if (!first) return null;
    const point = pickCube.worldToLocal(first.point.clone());
    const band = (v: number): AxisBand =>
      v > FACE_THRESHOLD ? 'pos' : v < -FACE_THRESHOLD ? 'neg' : 'mid';
    const bx = band(point.x);
    const by = band(point.y);
    const bz = band(point.z);
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
    cubeBody.geometry.dispose();
    cubeBody.material.dispose();
    edges.geometry.dispose();
    edges.material.dispose();
    pickCube.geometry.dispose();
    pickCube.material.dispose();
    for (const decal of faceDecals) {
      decal.geometry.dispose();
      const m = decal.material as MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
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
