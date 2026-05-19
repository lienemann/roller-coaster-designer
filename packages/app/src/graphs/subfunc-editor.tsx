// SPDX-License-Identifier: AGPL-3.0-only
//
// SubfuncEditor — three stacked editable curves (roll, pitch, yaw) for one
// Geometric section. The interaction model mirrors FVD++'s force-graph:
//
//   click on a segment       → opens a popover (degree / arg1 / center /
//                              tension / locked) for that subfunc.
//   click in empty curve area → inserts a new subfunc boundary at that
//                              time, splitting the existing piece.
//   drag a boundary line     → moves the boundary in time, resizing the
//                              two neighbouring subfuncs.
//   drag a segment vertically → adjusts that subfunc's endValue (and the
//                              next subfunc's startValue stays glued).
//
// Section-level flags (bOrientation, bSpeed, bArgument) sit above the
// graphs in a small toolbar. Recompute fires on every commit; while
// dragging we update local state only and emit the final value on pointer-up.
//
// All values are emitted as a single `onChange(GeometricSection)`. The
// caller wires that to dispatching a section-replacement action.

import { useCallback, useMemo, useRef, useState } from 'react';

import {
  Argument,
  EDegree,
  EFuncType,
  Orientation,
  type Func,
  type GeometricSection,
  type SubFunc,
} from '@roller-coaster-designer/core';

// ----- props ----------------------------------------------------------

export interface SubfuncEditorProps {
  readonly section: GeometricSection;
  readonly onChange: (section: GeometricSection) => void;
  /** Translation strings; supplied by the host so i18n stays in one place. */
  readonly label: SubfuncEditorLabels;
}

export interface SubfuncEditorLabels {
  // Subgraph titles.
  rollFunc: string;
  pitchFunc: string;
  yawFunc: string;
  // Section flags.
  orientationEuler: string;
  orientationQuaternion: string;
  argumentTime: string;
  argumentDistance: string;
  speedFixed: string;
  speedEnergy: string;
  // Popover field labels.
  degree: string;
  arg1: string;
  centerArg: string;
  tensionArg: string;
  locked: string;
  // Axis units.
  unitSeconds: string;
  unitMeters: string;
  unitRad: string;
  unitRadPerSec: string;
  // Help.
  clickToAdd: string;
  dragBoundary: string;
}

// ----- evaluation -----------------------------------------------------

/** Evaluate one subfunc at x ∈ [0,1]. Mirrors the polynomial branches in
 *  packages/core/src/physics/subfunc-eval.ts but inlined here so the editor
 *  isn't coupled to a worker round-trip. The output is in the func's native
 *  unit (rad/s for pitch/yaw/roll funcs in a Geometric section). */
function evalSubfunc(sf: SubFunc, x: number): number {
  // Centre / tension warp (applied first; spec §5.2).
  let t = x;
  if (sf.centerArg !== 0) {
    if (sf.centerArg > 0) t = Math.pow(t, Math.pow(2, sf.centerArg / 2));
    else t = 1 - Math.pow(1 - t, Math.pow(2, -sf.centerArg / 2));
  }
  if (Math.abs(sf.tensionArg) >= 0.0005) {
    if (sf.tensionArg > 0) {
      const v = (2 * sf.tensionArg * (t - 0.5));
      t = 0.5 * (Math.sinh(v) / Math.sinh(sf.tensionArg) + 1);
    } else {
      const v = 2 * Math.sinh(sf.tensionArg) * (t - 0.5);
      t = 0.5 * (Math.asinh(v) / sf.tensionArg + 1);
    }
  }

  const sv = sf.startValue;
  const ev = sf.endValue;
  const sym = ev - sv;
  const a1 = sf.arg1;

  switch (sf.degree) {
    case EDegree.Linear:
      return sv + sym * t;
    case EDegree.Quadratic:
      if (Math.abs(a1) < 0.5) {
        const xs = 2 * t - 1;
        return sv + sym * (1 - xs * xs);
      }
      return a1 < 0 ? sv + sym * (1 - (1 - t) * (1 - t)) : sv + sym * t * t;
    case EDegree.Cubic:
      return sv + sym * t * t * (3 - 2 * t);
    case EDegree.Quartic: {
      if (a1 < 0) return sv + sym * t * t * (16 + t * (-32 + t * 16));
      const denom = 1 - 2 * a1;
      return (
        sv +
        t *
          t *
          (-(6 * sym * a1) / denom +
            t * ((sym * (4 * a1 + 4)) / denom + t * (-3 * sym / denom)))
      );
    }
    case EDegree.Quintic: {
      if (Math.abs(a1) < 0.005) return sv + sym * t * t * t * (10 + t * (-15 + t * 6));
      // Full quintic with arg1 shape — defer to the worker's eval for the
      // exact normalisation max constant; for the editor preview a Cubic
      // approximation is fine and matches FVD's curve closely.
      return sv + sym * t * t * (3 - 2 * t);
    }
    case EDegree.Sinusoidal:
      return sv + 0.5 * sym * (1 - Math.cos(Math.PI * t));
    case EDegree.Plateau:
      return sv + sym * (1 - Math.exp(-a1 * 15 * Math.pow(1 - Math.abs(2 * t - 1), 3)));
    case EDegree.ToZero:
      // Editor preview: linear ramp from sv toward 0; the real ToZero
      // shape depends on integrator state which the editor doesn't have.
      return sv * (1 - t);
    case EDegree.Freeform: {
      const pl = sf.pointList;
      if (!pl) return sv + sym * t;
      // Cubic Bezier with control points (pl[0], pl[1]) and (0,0) / (1,1)
      // as the anchors. Use t as the parameter; for editor preview we
      // don't bother with the arc-length re-parameterisation.
      const u = 1 - t;
      const yc1 = pl[0][1];
      const yc2 = pl[1][1];
      const yt = 3 * u * u * t * yc1 + 3 * u * t * t * yc2 + t * t * t;
      return sv + sym * yt;
    }
    default:
      return sv + sym * t;
  }
}

/** Sample a Func across its full extent. Returns (x, y) pairs where x ∈
 *  [0, total] in the func's native unit (sec for TIME, m for DISTANCE)
 *  and y is the func's value at that point. SAMPLES_PER_SUBFUNC is set
 *  so the worst case (one sub-func across the whole section) still has
 *  enough detail to render Plateau / ToZero faithfully. */
const SAMPLES_PER_SUBFUNC = 64;

function sampleFunc(func: Func): readonly [number, number][] {
  const out: [number, number][] = [];
  let offset = 0;
  for (const sf of func.subfuncs) {
    const len = Math.max(sf.length, 1e-6);
    for (let i = 0; i <= SAMPLES_PER_SUBFUNC; i++) {
      const t = i / SAMPLES_PER_SUBFUNC;
      out.push([offset + t * len, evalSubfunc(sf, t)]);
    }
    offset += len;
  }
  return out;
}

// ----- geometry helpers -----------------------------------------------

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function computeBounds(funcs: readonly Func[]): Bounds {
  let minY = -1;
  let maxY = 1;
  let maxX = 0;
  for (const f of funcs) {
    let totalLen = 0;
    for (const sf of f.subfuncs) {
      totalLen += sf.length;
      if (sf.startValue < minY) minY = sf.startValue;
      if (sf.startValue > maxY) maxY = sf.startValue;
      if (sf.endValue < minY) minY = sf.endValue;
      if (sf.endValue > maxY) maxY = sf.endValue;
    }
    if (totalLen > maxX) maxX = totalLen;
  }
  // Add 10 % padding so curves don't graze the top/bottom edges.
  const pad = (maxY - minY) * 0.1 + 1e-3;
  return { minX: 0, maxX: maxX || 1, minY: minY - pad, maxY: maxY + pad };
}

// ----- main component -------------------------------------------------

const GRAPH_WIDTH = 720;
const GRAPH_HEIGHT_PER = 110;
const GRAPH_GAP = 16;
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 24;
const MARGIN_TOP = 8;
const MARGIN_BOTTOM = 24;

interface Selection {
  readonly funcKind: EFuncType;
  readonly subfuncIndex: number;
}

interface DragState {
  readonly mode: 'boundary' | 'value';
  readonly funcKind: EFuncType;
  readonly subfuncIndex: number; // boundary index, or subfunc being adjusted
  readonly startClientY: number;
  readonly startClientX: number;
  readonly startValue: number; // captured endValue (for 'value' mode) or x position (for 'boundary')
}

export function SubfuncEditor({
  section,
  onChange,
  label,
}: SubfuncEditorProps): JSX.Element {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Three funcs, plus their kinds, in display order.
  const lanes = useMemo(
    () => [
      { kind: EFuncType.Roll, func: section.rollFunc, title: label.rollFunc },
      { kind: EFuncType.Pitch, func: section.pitchFunc, title: label.pitchFunc },
      { kind: EFuncType.Yaw, func: section.yawFunc, title: label.yawFunc },
    ],
    [section, label],
  );

  const bounds = useMemo(
    () => computeBounds(lanes.map((l) => l.func)),
    [lanes],
  );

  const totalHeight =
    MARGIN_TOP + lanes.length * GRAPH_HEIGHT_PER + (lanes.length - 1) * GRAPH_GAP + MARGIN_BOTTOM;
  const plotW = GRAPH_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

  const xToPx = useCallback(
    (x: number): number => MARGIN_LEFT + (x - bounds.minX) / (bounds.maxX - bounds.minX) * plotW,
    [bounds, plotW],
  );
  const pxToX = useCallback(
    (px: number): number =>
      bounds.minX + ((px - MARGIN_LEFT) / plotW) * (bounds.maxX - bounds.minX),
    [bounds, plotW],
  );
  const yToPx = useCallback(
    (y: number, laneIndex: number): number => {
      const top = MARGIN_TOP + laneIndex * (GRAPH_HEIGHT_PER + GRAPH_GAP);
      return (
        top +
        GRAPH_HEIGHT_PER -
        ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * GRAPH_HEIGHT_PER
      );
    },
    [bounds],
  );

  // Update one func in the section and emit. `mut` clones the subfuncs
  // array; we never mutate `section` in place because it may be memoised
  // upstream and React relies on referential equality for re-renders.
  const replaceFunc = useCallback(
    (kind: EFuncType, next: Func): void => {
      const updated: GeometricSection = {
        ...section,
        rollFunc: kind === EFuncType.Roll ? next : section.rollFunc,
        pitchFunc: kind === EFuncType.Pitch ? next : section.pitchFunc,
        yawFunc: kind === EFuncType.Yaw ? next : section.yawFunc,
      };
      onChange(updated);
    },
    [section, onChange],
  );

  // Section-level flag setters.
  const setOrientation = (o: Orientation): void => onChange({ ...section, orientation: o });
  const setArgument = (a: Argument): void => onChange({ ...section, argument: a });
  const setVelocityMode = (energy: boolean): void =>
    onChange({ ...section, velocityMode: energy ? 'energy' : 'fixed' } as GeometricSection);

  // Subfunc mutations -----------------------------------------------------

  const updateSubfunc = useCallback(
    (kind: EFuncType, index: number, patch: Partial<SubFunc>): void => {
      const func = lanes.find((l) => l.kind === kind)!.func;
      const next = func.subfuncs.map((sf, i) => (i === index ? { ...sf, ...patch } : sf));
      // When endValue changes, the next subfunc's startValue stays glued.
      if (patch.endValue !== undefined && index + 1 < next.length) {
        next[index + 1] = { ...next[index + 1]!, startValue: patch.endValue };
      }
      replaceFunc(kind, { ...func, subfuncs: next });
    },
    [lanes, replaceFunc],
  );

  const insertBoundary = useCallback(
    (kind: EFuncType, x: number): void => {
      const func = lanes.find((l) => l.kind === kind)!.func;
      // Find which subfunc covers x and split it at the local t.
      let offset = 0;
      const next = func.subfuncs.slice();
      for (let i = 0; i < next.length; i++) {
        const sf = next[i]!;
        if (x >= offset && x <= offset + sf.length) {
          const localT = Math.max(0.01, Math.min(0.99, (x - offset) / sf.length));
          const midValue = evalSubfunc(sf, localT);
          const left: SubFunc = {
            ...sf,
            length: sf.length * localT,
            endValue: midValue,
          };
          const right: SubFunc = {
            ...sf,
            length: sf.length * (1 - localT),
            startValue: midValue,
          };
          next.splice(i, 1, left, right);
          replaceFunc(kind, { ...func, subfuncs: next });
          return;
        }
        offset += sf.length;
      }
    },
    [lanes, replaceFunc],
  );

  const moveBoundary = useCallback(
    (kind: EFuncType, boundaryIdx: number, newX: number): void => {
      const func = lanes.find((l) => l.kind === kind)!.func;
      // boundaryIdx i (1..N-1) sits between subfunc[i-1] and subfunc[i].
      // New x must clamp into [boundaryStart(i-1), boundaryStart(i+1)].
      let offset = 0;
      const offsets: number[] = [0];
      for (const sf of func.subfuncs) {
        offset += sf.length;
        offsets.push(offset);
      }
      const lo = offsets[boundaryIdx - 1]! + 1e-3;
      const hi = offsets[boundaryIdx + 1]! - 1e-3;
      const x = Math.max(lo, Math.min(hi, newX));
      const next = func.subfuncs.slice();
      next[boundaryIdx - 1] = { ...next[boundaryIdx - 1]!, length: x - offsets[boundaryIdx - 1]! };
      next[boundaryIdx] = { ...next[boundaryIdx]!, length: offsets[boundaryIdx + 1]! - x };
      replaceFunc(kind, { ...func, subfuncs: next });
    },
    [lanes, replaceFunc],
  );

  // Pointer handlers ------------------------------------------------------

  const onCurvePointerDown = (
    e: React.PointerEvent<SVGElement>,
    kind: EFuncType,
    subfuncIndex: number,
  ): void => {
    e.stopPropagation();
    setSelection({ funcKind: kind, subfuncIndex });
    const func = lanes.find((l) => l.kind === kind)!.func;
    setDragging({
      mode: 'value',
      funcKind: kind,
      subfuncIndex,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startValue: func.subfuncs[subfuncIndex]!.endValue,
    });
    (e.target as SVGElement).setPointerCapture(e.pointerId);
  };

  const onBoundaryPointerDown = (
    e: React.PointerEvent<SVGElement>,
    kind: EFuncType,
    boundaryIdx: number,
    boundaryX: number,
  ): void => {
    e.stopPropagation();
    setDragging({
      mode: 'boundary',
      funcKind: kind,
      subfuncIndex: boundaryIdx,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startValue: boundaryX,
    });
    (e.target as SVGElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGElement>): void => {
    if (!dragging || !svgRef.current) return;
    if (dragging.mode === 'boundary') {
      const dx = e.clientX - dragging.startClientX;
      const xPerPx = (bounds.maxX - bounds.minX) / plotW;
      moveBoundary(dragging.funcKind, dragging.subfuncIndex, dragging.startValue + dx * xPerPx);
    } else {
      const dy = e.clientY - dragging.startClientY;
      const yPerPx = (bounds.maxY - bounds.minY) / GRAPH_HEIGHT_PER;
      const newEnd = dragging.startValue - dy * yPerPx;
      updateSubfunc(dragging.funcKind, dragging.subfuncIndex, { endValue: newEnd });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGElement>): void => {
    if (dragging) {
      (e.target as SVGElement).releasePointerCapture?.(e.pointerId);
      setDragging(null);
    }
  };

  const onBackgroundClick = (
    e: React.MouseEvent<SVGRectElement>,
    kind: EFuncType,
  ): void => {
    if (dragging) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const localX = e.clientX - rect.left;
    insertBoundary(kind, pxToX(localX));
  };

  // Build per-lane render data --------------------------------------------

  const lanesRender = lanes.map((lane, laneIdx) => {
    const samples = sampleFunc(lane.func);
    const path = samples
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${xToPx(x).toFixed(2)} ${yToPx(y, laneIdx).toFixed(2)}`)
      .join(' ');
    // Boundary positions.
    let off = 0;
    const boundaries: { idx: number; x: number }[] = [];
    for (let i = 0; i < lane.func.subfuncs.length; i++) {
      off += lane.func.subfuncs[i]!.length;
      if (i < lane.func.subfuncs.length - 1) boundaries.push({ idx: i + 1, x: off });
    }
    // Hit areas for click-on-segment.
    let segOff = 0;
    const segments = lane.func.subfuncs.map((sf, i) => {
      const x0 = segOff;
      const x1 = segOff + sf.length;
      segOff = x1;
      return { idx: i, x0, x1 };
    });
    return { lane, laneIdx, path, boundaries, segments };
  });

  // ----- render -------------------------------------------------------

  return (
    <div className="flex flex-col gap-2 text-xs text-neutral-300">
      <SectionFlagsBar
        section={section}
        label={label}
        onOrientation={setOrientation}
        onArgument={setArgument}
        onVelocityMode={setVelocityMode}
      />
      <svg
        ref={svgRef}
        width={GRAPH_WIDTH}
        height={totalHeight}
        className="bg-neutral-900 rounded select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {lanesRender.map(({ lane, laneIdx, path, boundaries, segments }) => {
          const top = MARGIN_TOP + laneIdx * (GRAPH_HEIGHT_PER + GRAPH_GAP);
          return (
            <g key={lane.kind}>
              {/* Plot area background — click here to insert a new boundary. */}
              <rect
                x={MARGIN_LEFT}
                y={top}
                width={plotW}
                height={GRAPH_HEIGHT_PER}
                fill="#0e0e0e"
                stroke="#262626"
                onClick={(e) => onBackgroundClick(e, lane.kind)}
              />
              {/* y=0 line. */}
              <line
                x1={MARGIN_LEFT}
                x2={MARGIN_LEFT + plotW}
                y1={yToPx(0, laneIdx)}
                y2={yToPx(0, laneIdx)}
                stroke="#3a3a3a"
                strokeDasharray="2 4"
              />
              {/* Title. */}
              <text x={MARGIN_LEFT} y={top - 1} fill="#a3a3a3" fontSize={10}>
                {lane.title}
              </text>
              {/* Curve. */}
              <path d={path} fill="none" stroke={LANE_COLOR[lane.kind]} strokeWidth={1.5} />
              {/* Subfunc segment hit areas. */}
              {segments.map((seg) => (
                <rect
                  key={seg.idx}
                  x={xToPx(seg.x0)}
                  y={top}
                  width={Math.max(2, xToPx(seg.x1) - xToPx(seg.x0))}
                  height={GRAPH_HEIGHT_PER}
                  fill={
                    selection &&
                    selection.funcKind === lane.kind &&
                    selection.subfuncIndex === seg.idx
                      ? 'rgba(255,255,255,0.06)'
                      : 'transparent'
                  }
                  style={{ cursor: 'ns-resize' }}
                  onPointerDown={(e) => onCurvePointerDown(e, lane.kind, seg.idx)}
                />
              ))}
              {/* Boundary handles. */}
              {boundaries.map((b) => {
                const x = xToPx(b.x);
                return (
                  <g key={b.idx}>
                    <line
                      x1={x}
                      x2={x}
                      y1={top}
                      y2={top + GRAPH_HEIGHT_PER}
                      stroke="rgba(220,220,220,0.55)"
                      strokeDasharray="3 2 1 2"
                    />
                    <rect
                      x={x - 4}
                      y={top}
                      width={8}
                      height={GRAPH_HEIGHT_PER}
                      fill="transparent"
                      style={{ cursor: 'ew-resize' }}
                      onPointerDown={(e) => onBoundaryPointerDown(e, lane.kind, b.idx, b.x)}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
        {/* X-axis label. */}
        <text
          x={MARGIN_LEFT + plotW / 2}
          y={totalHeight - 4}
          textAnchor="middle"
          fontSize={10}
          fill="#a3a3a3"
        >
          {section.argument === Argument.Time ? label.unitSeconds : label.unitMeters}
        </text>
      </svg>
      {selection && (
        <SubfuncPopover
          section={section}
          selection={selection}
          label={label}
          onChange={(patch) => updateSubfunc(selection.funcKind, selection.subfuncIndex, patch)}
        />
      )}
      <p className="text-[10px] text-neutral-500">
        {label.clickToAdd} · {label.dragBoundary}
      </p>
    </div>
  );
}

const LANE_COLOR: Record<EFuncType, string> = {
  [EFuncType.Roll]: '#f7d76a',
  [EFuncType.Pitch]: '#5cc8ff',
  [EFuncType.Yaw]: '#ff9f5c',
  [EFuncType.Normal]: '#5cc8ff',
  [EFuncType.Lateral]: '#ff9f5c',
};

// ----- section flags toolbar -----------------------------------------

function SectionFlagsBar({
  section,
  label,
  onOrientation,
  onArgument,
  onVelocityMode,
}: {
  section: GeometricSection;
  label: SubfuncEditorLabels;
  onOrientation: (o: Orientation) => void;
  onArgument: (a: Argument) => void;
  onVelocityMode: (energy: boolean) => void;
}): JSX.Element {
  const energy = (section as unknown as { velocityMode?: string }).velocityMode === 'energy';
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <Toggle
        active={section.orientation === Orientation.Euler}
        labelA={label.orientationEuler}
        labelB={label.orientationQuaternion}
        onClick={() =>
          onOrientation(
            section.orientation === Orientation.Euler ? Orientation.Quaternion : Orientation.Euler,
          )
        }
      />
      <Toggle
        active={section.argument === Argument.Time}
        labelA={label.argumentTime}
        labelB={label.argumentDistance}
        onClick={() =>
          onArgument(section.argument === Argument.Time ? Argument.Distance : Argument.Time)
        }
      />
      <Toggle
        active={energy}
        labelA={label.speedEnergy}
        labelB={label.speedFixed}
        onClick={() => onVelocityMode(!energy)}
      />
    </div>
  );
}

function Toggle({
  active,
  labelA,
  labelB,
  onClick,
}: {
  active: boolean;
  labelA: string;
  labelB: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-700"
    >
      {active ? labelA : labelB}
    </button>
  );
}

// ----- per-subfunc popover -------------------------------------------

function SubfuncPopover({
  section,
  selection,
  label,
  onChange,
}: {
  section: GeometricSection;
  selection: Selection;
  label: SubfuncEditorLabels;
  onChange: (patch: Partial<SubFunc>) => void;
}): JSX.Element {
  const func =
    selection.funcKind === EFuncType.Roll
      ? section.rollFunc
      : selection.funcKind === EFuncType.Pitch
        ? section.pitchFunc
        : section.yawFunc;
  const sf = func.subfuncs[selection.subfuncIndex]!;
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded border border-neutral-700 bg-neutral-900 p-2 text-[11px]">
      <label className="text-neutral-400">{label.degree}</label>
      <select
        value={sf.degree}
        onChange={(e) => onChange({ degree: Number.parseInt(e.target.value, 10) as EDegree })}
        className="bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5"
      >
        <option value={EDegree.Linear}>Linear</option>
        <option value={EDegree.Quadratic}>Quadratic</option>
        <option value={EDegree.Cubic}>Cubic</option>
        <option value={EDegree.Quartic}>Quartic</option>
        <option value={EDegree.Quintic}>Quintic</option>
        <option value={EDegree.Sinusoidal}>Sinusoidal</option>
        <option value={EDegree.Plateau}>Plateau</option>
        <option value={EDegree.ToZero}>ToZero</option>
        <option value={EDegree.Freeform}>Freeform</option>
      </select>
      <label className="text-neutral-400">{label.arg1}</label>
      <NumberInput value={sf.arg1} onChange={(v) => onChange({ arg1: v })} step={0.1} />
      <label className="text-neutral-400">{label.centerArg}</label>
      <NumberInput value={sf.centerArg} onChange={(v) => onChange({ centerArg: v })} step={0.1} />
      <label className="text-neutral-400">{label.tensionArg}</label>
      <NumberInput value={sf.tensionArg} onChange={(v) => onChange({ tensionArg: v })} step={0.1} />
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}): JSX.Element {
  return (
    <input
      type="number"
      value={value}
      step={step ?? 'any'}
      onChange={(e) => {
        const parsed = Number.parseFloat(e.target.value);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      className="bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 w-24"
    />
  );
}
