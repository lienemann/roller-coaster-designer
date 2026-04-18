// SPDX-License-Identifier: AGPL-3.0-only

import {
  EDegree,
  EFuncType,
  SecType,
  createEmptyFunc,
  type Func,
  type Section,
  type SubFunc,
} from '@roller-coaster-designer/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '../state/store.js';

/**
 * Right-rail panel that edits the selected section's scalar properties.
 * Angles render in degrees; the integrator and file format keep radians
 * internally (spec §4.5). Numeric inputs commit on change — no apply
 * button — because Zustand's `patchSelectedSection` already deep-copies
 * the touched track.
 *
 * Pose fields (anchor position / pitch / yaw / speed) and geometry fields
 * (length, pitchRate, yawRate, lead-in/out) are rendered. Roll functions,
 * sub-function shapes, and Bezier control-point wrangling stay in the
 * Timeline v2 work at a later milestone; until then the sections panel
 * "Remove" + "Add" is the escape hatch for wholesale changes.
 */
export function PropertiesPanel(): JSX.Element {
  const { t } = useTranslation('common');
  const selectedIndex = useAppStore((s) => s.selectedSectionIndex);
  const project = useAppStore((s) => s.project);
  const patch = useAppStore((s) => s.patchSelectedSection);

  const section = useMemo(() => {
    if (project === null || selectedIndex === null) return null;
    return project.tracks[0]?.sections[selectedIndex] ?? null;
  }, [project, selectedIndex]);

  const previousSection = useMemo(() => {
    if (project === null || selectedIndex === null || selectedIndex <= 0) return null;
    return project.tracks[0]?.sections[selectedIndex - 1] ?? null;
  }, [project, selectedIndex]);

  if (!section) {
    return (
      <div className="flex h-full flex-col gap-2">
        <header className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {t('panels.properties')}
        </header>
        <p className="text-xs text-neutral-500">{t('properties.empty')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {t('panels.properties')}
      </header>

      <Field
        label={t('properties.name')}
        value={section.name}
        type="text"
        onChange={(v) => patch({ name: typeof v === 'string' ? v : String(v) })}
      />

      {section.type === SecType.Anchor && <AnchorFields section={section} patch={patch} t={t} />}
      {section.type === SecType.Straight && (
        <StraightFields section={section} patch={patch} t={t} />
      )}
      {section.type === SecType.Curved && <CurvedFields section={section} patch={patch} t={t} />}
      {section.type === SecType.Bezier && <BezierFields section={section} patch={patch} t={t} />}
      {section.type === SecType.NoLimitsCSV && (
        <p className="text-xs text-neutral-500">{t('properties.nlCsvReadonly')}</p>
      )}

      {sectionHasRollFunc(section) && (
        <BankingGroup section={section} previousSection={previousSection} patch={patch} t={t} />
      )}
    </div>
  );
}

// --- per-section-type field groups ----------------------------------------

type Patcher = (patch: Partial<Section>) => void;
type Translate = (key: string) => string;

function AnchorFields({
  section,
  patch,
  t,
}: {
  section: Extract<Section, { type: SecType.Anchor }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  return (
    <>
      <Vec3Field
        label={t('properties.position')}
        value={section.position}
        onChange={(position) => patch({ position })}
      />
      <Field
        label={t('properties.pitch')}
        value={radToDeg(section.pitch)}
        onChange={(v) => patch({ pitch: degToRad(asNumber(v)) })}
        suffix="°"
        min={-90}
        max={90}
        step={1}
      />
      <Field
        label={t('properties.yaw')}
        value={radToDeg(section.yaw)}
        onChange={(v) => patch({ yaw: degToRad(asNumber(v)) })}
        suffix="°"
        min={-180}
        max={180}
        step={1}
      />
      <Field
        label={t('properties.roll')}
        value={radToDeg(section.roll)}
        onChange={(v) => patch({ roll: degToRad(asNumber(v)) })}
        suffix="°"
        min={-180}
        max={180}
        step={1}
      />
      <Field
        label={t('properties.speed')}
        value={section.speed}
        onChange={(v) => patch({ speed: asNumber(v) })}
        suffix="m/s"
        min={0}
        max={60}
        step={0.5}
      />
    </>
  );
}

function StraightFields({
  section,
  patch,
  t,
}: {
  section: Extract<Section, { type: SecType.Straight }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  return (
    <Field
      label={t('properties.length')}
      value={section.length}
      onChange={(v) => patch({ length: Math.max(0, asNumber(v)) })}
      suffix="m"
    />
  );
}

type CurvedMode = 'rate' | 'totalAngle' | 'axisAngle';

function CurvedFields({
  section,
  patch,
  t,
}: {
  section: Extract<Section, { type: SecType.Curved }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  // Stored shape never changes — it's always (length, pitchRate, yawRate).
  // `mode` is UI-only: "rate" shows rad/m directly, "totalAngle" lets the
  // user type pitch and yaw angles for the whole section, "axisAngle"
  // expresses a single rotation around a chosen axis. All three write back
  // through the same patch() call so recompute and round-trip stay agnostic.
  const [mode, setMode] = useState<CurvedMode>('rate');

  const length = section.length;
  const pitchRate = section.pitchRate;
  const yawRate = section.yawRate;

  // Total-angle view: rate × length. Editing an angle field solves for
  // rate = angle / length (or zero when length ≤ 0).
  const totalPitchDeg = radToDeg(pitchRate * length);
  const totalYawDeg = radToDeg(yawRate * length);
  const setTotalPitchDeg = (deg: number): void => {
    patch({ pitchRate: length > 0 ? degToRad(deg) / length : 0 });
  };
  const setTotalYawDeg = (deg: number): void => {
    patch({ yawRate: length > 0 ? degToRad(deg) / length : 0 });
  };

  // Axis-angle view: combine pitch and yaw into a single total-rotation
  // magnitude with an axis direction (unit vector in the pitch/yaw plane).
  // Stored orientation of this axis is arbitrary — we pick the natural
  // "first rotate yaw, then pitch" decomposition so pure yaw → axis = (0,1),
  // pure pitch → axis = (1,0).
  const totalPitch = pitchRate * length;
  const totalYaw = yawRate * length;
  const totalAngleDeg = radToDeg(Math.hypot(totalPitch, totalYaw));
  const axisAngleDeg = totalAngleDeg < 1e-6 ? 0 : radToDeg(Math.atan2(totalPitch, totalYaw));
  const setAxisRotation = (angleDeg: number, axisDeg: number): void => {
    const angle = degToRad(angleDeg);
    const axis = degToRad(axisDeg);
    const pitch = angle * Math.sin(axis);
    const yaw = angle * Math.cos(axis);
    patch({
      pitchRate: length > 0 ? pitch / length : 0,
      yawRate: length > 0 ? yaw / length : 0,
    });
  };

  return (
    <>
      <Field
        label={t('properties.length')}
        value={length}
        onChange={(v) => patch({ length: Math.max(0, asNumber(v)) })}
        suffix="m"
      />

      <ModeSelector
        label={t('properties.curvedMode')}
        value={mode}
        options={[
          { value: 'rate', label: t('properties.curvedModeRate') },
          { value: 'totalAngle', label: t('properties.curvedModeTotal') },
          { value: 'axisAngle', label: t('properties.curvedModeAxis') },
        ]}
        onChange={setMode}
      />

      {mode === 'rate' && (
        <>
          <Field
            label={t('properties.pitchRate')}
            value={radToDeg(pitchRate)}
            onChange={(v) => patch({ pitchRate: degToRad(asNumber(v)) })}
            suffix="°/m"
            min={-20}
            max={20}
            step={0.1}
          />
          <Field
            label={t('properties.yawRate')}
            value={radToDeg(yawRate)}
            onChange={(v) => patch({ yawRate: degToRad(asNumber(v)) })}
            suffix="°/m"
            min={-20}
            max={20}
            step={0.1}
          />
        </>
      )}

      {mode === 'totalAngle' && (
        <>
          <Field
            label={t('properties.totalPitch')}
            value={totalPitchDeg}
            onChange={(v) => setTotalPitchDeg(asNumber(v))}
            suffix="°"
            min={-360}
            max={360}
            step={1}
          />
          <Field
            label={t('properties.totalYaw')}
            value={totalYawDeg}
            onChange={(v) => setTotalYawDeg(asNumber(v))}
            suffix="°"
            min={-360}
            max={360}
            step={1}
          />
        </>
      )}

      {mode === 'axisAngle' && (
        <>
          <Field
            label={t('properties.totalAngle')}
            value={totalAngleDeg}
            onChange={(v) => setAxisRotation(asNumber(v), axisAngleDeg)}
            suffix="°"
            min={0}
            max={720}
            step={1}
          />
          <Field
            label={t('properties.axisDirection')}
            value={axisAngleDeg}
            onChange={(v) => setAxisRotation(totalAngleDeg, asNumber(v))}
            suffix="°"
            min={-180}
            max={180}
            step={1}
          />
          <p className="text-[10px] leading-tight text-neutral-500">{t('properties.axisHint')}</p>
        </>
      )}

      <Field
        label={t('properties.leadIn')}
        value={section.leadIn}
        onChange={(v) => patch({ leadIn: Math.max(0, asNumber(v)) })}
        suffix="m"
        min={0}
        max={30}
        step={0.5}
      />
      <Field
        label={t('properties.leadOut')}
        value={section.leadOut}
        onChange={(v) => patch({ leadOut: Math.max(0, asNumber(v)) })}
        suffix="m"
        min={0}
        max={30}
        step={0.5}
      />
    </>
  );
}

function ModeSelector<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-neutral-400">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
        className="rounded border border-white/10 bg-surface-0 px-2 py-1 text-neutral-100 outline-none focus:border-white/30"
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function BezierFields({
  section,
  patch,
  t,
}: {
  section: Extract<Section, { type: SecType.Bezier }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  const points = section.controlPoints;
  const updatePoint = (index: 0 | 1 | 2 | 3, point: [number, number, number]): void => {
    const cp: Extract<Section, { type: SecType.Bezier }>['controlPoints'] = [
      points[0],
      points[1],
      points[2],
      points[3],
    ];
    cp[index] = point;
    patch({ controlPoints: cp });
  };
  return (
    <>
      <Vec3Field
        label={`P0 ${t('properties.start')}`}
        value={points[0]}
        onChange={(p) => updatePoint(0, p)}
      />
      <Vec3Field label="P1" value={points[1]} onChange={(p) => updatePoint(1, p)} />
      <Vec3Field label="P2" value={points[2]} onChange={(p) => updatePoint(2, p)} />
      <Vec3Field
        label={`P3 ${t('properties.end')}`}
        value={points[3]}
        onChange={(p) => updatePoint(3, p)}
      />
      <CheckboxField
        label={t('properties.smoothStart')}
        checked={section.smoothStart}
        onChange={(checked) => patch({ smoothStart: checked })}
      />
      <CheckboxField
        label={t('properties.smoothEnd')}
        checked={section.smoothEnd}
        onChange={(checked) => patch({ smoothEnd: checked })}
      />
    </>
  );
}

// --- banking (roll function) shortcut --------------------------------------

type SectionWithRoll = Extract<
  Section,
  {
    type: SecType.Straight | SecType.Curved | SecType.Forced | SecType.Geometric | SecType.Bezier;
  }
>;

function sectionHasRollFunc(section: Section): section is SectionWithRoll {
  return (
    section.type === SecType.Straight ||
    section.type === SecType.Curved ||
    section.type === SecType.Forced ||
    section.type === SecType.Geometric ||
    section.type === SecType.Bezier
  );
}

/** Meters (or seconds for Forced/Geometric) that the rollFunc covers. */
function rollFuncExtent(section: SectionWithRoll): number {
  switch (section.type) {
    case SecType.Straight:
    case SecType.Curved:
      return section.length;
    case SecType.Forced:
    case SecType.Geometric:
      return section.extent;
    case SecType.Bezier: {
      const [p0, , , p3] = section.controlPoints;
      // Chord distance as an arc-length proxy. Good enough for UX here; the
      // integrator re-derives true arc length from the curve at recompute.
      const dx = p3[0] - p0[0];
      const dy = p3[1] - p0[1];
      const dz = p3[2] - p0[2];
      return Math.hypot(dx, dy, dz) || 1;
    }
  }
}

/** Banking at the start of the roll function (radians). */
function rollStart(func: Func): number {
  return func.subfuncs[0]?.startValue ?? 0;
}

/** Banking at the end of the roll function (radians). */
function rollEnd(func: Func): number {
  if (func.subfuncs.length === 0) return 0;
  return func.subfuncs[func.subfuncs.length - 1]!.endValue;
}

/** Absolute banking target at the end of the previous section (radians). */
function previousEndRoll(previousSection: Section | null): number {
  if (!previousSection) return 0;
  if (previousSection.type === SecType.Anchor) return previousSection.roll;
  if (sectionHasRollFunc(previousSection)) return rollEnd(previousSection.rollFunc);
  return 0;
}

/** Replace the rollFunc with a single Cubic subfunc spanning start → end. */
function singleCubicRollFunc(
  existing: Func,
  startValue: number,
  endValue: number,
  length: number,
): Func {
  const subfunc: SubFunc = {
    degree: EDegree.Cubic,
    length: Math.max(length, 1e-3),
    startValue,
    endValue,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  };
  const next = createEmptyFunc(EFuncType.Roll, existing.name || 'Roll');
  next.locked = existing.locked;
  next.subfuncs = [subfunc];
  return next;
}

function BankingGroup({
  section,
  previousSection,
  patch,
  t,
}: {
  section: SectionWithRoll;
  previousSection: Section | null;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  const extent = rollFuncExtent(section);
  const startRad = rollStart(section.rollFunc);
  const endRad = rollEnd(section.rollFunc);

  const setStart = (deg: number): void => {
    const rollFunc = singleCubicRollFunc(section.rollFunc, degToRad(deg), endRad, extent);
    patch({ rollFunc });
  };
  const setEnd = (deg: number): void => {
    const rollFunc = singleCubicRollFunc(section.rollFunc, startRad, degToRad(deg), extent);
    patch({ rollFunc });
  };
  const syncWithPrevious = (): void => {
    const target = previousEndRoll(previousSection);
    const rollFunc = singleCubicRollFunc(section.rollFunc, target, endRad, extent);
    patch({ rollFunc });
  };

  return (
    <fieldset className="flex flex-col gap-2 border-t border-white/10 pt-3">
      <legend className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {t('properties.banking')}
      </legend>

      <Field
        label={t('properties.bankingStart')}
        value={radToDeg(startRad)}
        onChange={(v) => setStart(asNumber(v))}
        suffix="°"
        min={-180}
        max={180}
        step={1}
      />
      <Field
        label={t('properties.bankingEnd')}
        value={radToDeg(endRad)}
        onChange={(v) => setEnd(asNumber(v))}
        suffix="°"
        min={-180}
        max={180}
        step={1}
      />
      <button
        type="button"
        onClick={syncWithPrevious}
        disabled={previousSection === null}
        className="mt-1 rounded border border-white/10 bg-surface-2 px-2 py-1 text-left text-xs text-neutral-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        title={t('properties.bankingSyncHint')}
      >
        {t('properties.bankingSync')}
      </button>
      <p className="text-[10px] leading-tight text-neutral-500">
        {t('properties.bankingShortcutNote')}
      </p>
    </fieldset>
  );
}

// --- generic input widgets -------------------------------------------------

function Field(props: {
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  type?: 'text' | 'number';
  suffix?: string;
  /** When supplied together, render a range slider next to the number input.
   *  The slider stays in sync with the number field — dragging the slider
   *  calls onChange with the discrete value, typing bypasses the slider
   *  bounds so users can still enter anything. */
  min?: number;
  max?: number;
  step?: number;
}): JSX.Element {
  const isNumber = typeof props.value === 'number';
  const hasSlider = isNumber && props.min !== undefined && props.max !== undefined;
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-neutral-400">{props.label}</span>
        <span className="flex items-center gap-1">
          <input
            type={props.type ?? (isNumber ? 'number' : 'text')}
            step="any"
            value={String(props.value)}
            onChange={(e) => props.onChange(isNumber ? Number(e.target.value) : e.target.value)}
            className="w-24 rounded border border-white/10 bg-surface-0 px-2 py-1 text-right text-neutral-100 outline-none focus:border-white/30"
          />
          {props.suffix && <span className="w-6 text-left text-neutral-500">{props.suffix}</span>}
        </span>
      </span>
      {hasSlider && (
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={clampForSlider(Number(props.value), props.min!, props.max!)}
          onChange={(e) => props.onChange(Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-sky-400"
          aria-label={`${props.label} slider`}
        />
      )}
    </label>
  );
}

function clampForSlider(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function Vec3Field(props: {
  label: string;
  value: readonly [number, number, number];
  onChange: (value: [number, number, number]) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-neutral-400">{props.label}</span>
      <div className="grid grid-cols-3 gap-1">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <input
            key={axis}
            type="number"
            step="any"
            aria-label={`${props.label} ${axis}`}
            value={String(props.value[i]!)}
            onChange={(e) => {
              const next: [number, number, number] = [...props.value] as [number, number, number];
              next[i] = Number(e.target.value);
              props.onChange(next);
            }}
            className="w-full rounded border border-white/10 bg-surface-0 px-2 py-1 text-right text-neutral-100 outline-none focus:border-white/30"
          />
        ))}
      </div>
    </div>
  );
}

function CheckboxField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-300">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="h-3.5 w-3.5"
      />
      {props.label}
    </label>
  );
}

function asNumber(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
