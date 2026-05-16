// SPDX-License-Identifier: AGPL-3.0-only

import {
  Argument,
  EDegree,
  EFuncType,
  SecType,
  createEmptyFunc,
  firstCubicOf,
  replaceFirstCubic,
  type Func,
  type Section,
  type SubFunc,
} from '@roller-coaster-designer/core';
import { useEffect, useMemo, useState } from 'react';
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
 * (Curved: fAngle / fRadius / fDirection / fLeadIn / fLeadOut, mirroring
 * FVD++; Forced + Geometric: extent + driver funcs) are rendered. Roll
 * functions, sub-function shapes, and Bezier control-point wrangling stay
 * in the Timeline v2 work; until then "Remove" + "Add" is the escape hatch.
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

      <ColorField
        label={t('properties.color')}
        value={section.color ?? ''}
        onChange={(value) => patch({ color: value || undefined })}
        resetLabel={t('properties.colorReset')}
      />

      {section.type === SecType.Anchor && <AnchorFields section={section} patch={patch} t={t} />}
      {section.type === SecType.Straight && (
        <StraightFields section={section} patch={patch} t={t} />
      )}
      {section.type === SecType.Curved && <CurvedFields section={section} patch={patch} t={t} />}
      {section.type === SecType.Forced && <ForcedFields section={section} patch={patch} t={t} />}
      {section.type === SecType.Geometric && (
        <GeometricFields section={section} patch={patch} t={t} />
      )}
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
    <>
      <Field
        label={t('properties.length')}
        value={section.length}
        onChange={(v) => patch({ length: Math.max(0, asNumber(v)) })}
        suffix="m"
      />
      <HeldVelocityFields section={section} patch={patch} t={t} />
    </>
  );
}

/** bSpeed / fVel checkbox + input. Shared by Straight / Curved / Forced /
 *  Geometric (all the section types that carry FvdSpeedFields). When the
 *  checkbox is off, the integrator runs energy-driven (the default); when
 *  on, velocity is held at fVel for the duration of the section. */
function HeldVelocityFields({
  section,
  patch,
  t,
}: {
  section: { bSpeed?: boolean | undefined; fVel?: number | undefined };
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  const heldOn = section.bSpeed === false;
  return (
    <div className="rounded border border-white/5 bg-surface-2/50 p-2">
      <CheckboxField
        label={t('properties.heldVelocity')}
        checked={heldOn}
        onChange={(checked) => {
          // When turning on, default fVel to whatever was there or 10 m/s.
          // When turning off, drop the held flag entirely (back to default
          // energy-driven mode).
          if (checked) {
            patch({ bSpeed: false, fVel: section.fVel ?? 10 });
          } else {
            patch({ bSpeed: undefined, fVel: undefined });
          }
        }}
      />
      {heldOn && (
        <Field
          label={t('properties.fVel')}
          value={section.fVel ?? 10}
          onChange={(v) => patch({ fVel: Math.max(0, asNumber(v)) })}
          suffix="m/s"
          min={0}
          max={120}
          step={0.5}
        />
      )}
      <p className="mt-1 text-[10px] leading-tight text-neutral-500">
        {t('properties.heldVelocityHint')}
      </p>
    </div>
  );
}

function CurvedFields({
  section,
  patch,
  t,
}: {
  section: Extract<Section, { type: SecType.Curved }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  // Direct passthrough of FVD++'s Curved fields. The user sets total
  // angle, radius, and direction; the integrator builds the curve.
  // 360°/0° = vertical loop, 90° = level turn, intermediate = helix.
  return (
    <>
      <Field
        label={t('properties.fAngle')}
        value={section.fAngle}
        onChange={(v) => patch({ fAngle: Math.max(0, asNumber(v)) })}
        suffix="°"
        min={0}
        max={1440}
        step={1}
      />
      <Field
        label={t('properties.fRadius')}
        value={section.fRadius}
        onChange={(v) => patch({ fRadius: Math.max(0.1, asNumber(v)) })}
        suffix="m"
        min={0.1}
        max={500}
        step={0.5}
      />
      <Field
        label={t('properties.fDirection')}
        value={section.fDirection}
        onChange={(v) => patch({ fDirection: asNumber(v) })}
        suffix="°"
        min={-180}
        max={180}
        step={1}
      />
      <p className="text-[10px] leading-tight text-neutral-500">{t('properties.fDirectionHint')}</p>
      <Field
        label={t('properties.fLeadIn')}
        value={section.fLeadIn}
        onChange={(v) => patch({ fLeadIn: Math.max(0, asNumber(v)) })}
        suffix="°"
        min={0}
        max={90}
        step={1}
      />
      <Field
        label={t('properties.fLeadOut')}
        value={section.fLeadOut}
        onChange={(v) => patch({ fLeadOut: Math.max(0, asNumber(v)) })}
        suffix="°"
        min={0}
        max={90}
        step={1}
      />
      <HeldVelocityFields section={section} patch={patch} t={t} />
    </>
  );
}

function ForcedFields({
  section,
  patch,
  t,
}: {
  section: Extract<Section, { type: SecType.Forced }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  return (
    <>
      <Field
        label={t('properties.extent')}
        value={section.extent}
        onChange={(v) => patch({ extent: Math.max(0, asNumber(v)) })}
        suffix={section.argument === Argument.Distance ? 'm' : 's'}
        min={0}
        step={0.1}
      />
      <HeldVelocityFields section={section} patch={patch} t={t} />
    </>
  );
}

function GeometricFields({
  section,
  patch,
  t,
}: {
  section: Extract<Section, { type: SecType.Geometric }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  return (
    <>
      <Field
        label={t('properties.extent')}
        value={section.extent}
        onChange={(v) => patch({ extent: Math.max(0, asNumber(v)) })}
        suffix={section.argument === Argument.Distance ? 'm' : 's'}
        min={0}
        step={0.1}
      />
      <HeldVelocityFields section={section} patch={patch} t={t} />
    </>
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
  const points = firstCubicOf(section);
  const updatePoint = (index: 0 | 1 | 2 | 3, point: [number, number, number]): void => {
    const cp: [
      [number, number, number],
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ] = [points[0], points[1], points[2], points[3]];
    cp[index] = point;
    patch({ segments: replaceFirstCubic(section.segments, cp[0], cp[1], cp[2], cp[3]) });
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

/** Domain that the rollFunc covers — in metres for Straight / Bezier, in
 *  degrees of ridden angle for Curved, in seconds (or metres) for
 *  Forced/Geometric depending on argument. The UI uses this to size the
 *  domain field. */
function rollFuncExtent(section: SectionWithRoll): number {
  switch (section.type) {
    case SecType.Straight:
      return section.length;
    case SecType.Curved:
      return section.fAngle;
    case SecType.Forced:
    case SecType.Geometric:
      return section.extent;
    case SecType.Bezier: {
      const [p0, , , p3] = firstCubicOf(section);
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
        min={-720}
        max={720}
        step={1}
      />
      <Field
        label={t('properties.bankingEnd')}
        value={radToDeg(endRad)}
        onChange={(v) => setEnd(asNumber(v))}
        suffix="°"
        min={-720}
        max={720}
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
  const baseStep = props.step ?? 1;

  // Input buffer: while focused, show exactly what the user is typing;
  // while blurred, show the store's number rounded to ≤4 significant
  // digits so `0.09999999999` doesn't leak through floating-point math.
  const [focused, setFocused] = useState(false);
  const [buffer, setBuffer] = useState<string>('');
  const displayValue = focused
    ? buffer
    : isNumber
      ? formatDisplay(Number(props.value))
      : String(props.value);

  // Sync the buffer when the value changes from an EXTERNAL source (e.g.
  // the user drags the slider next to the input). Compares numerically,
  // so partial-typed strings like "1." don't snap back to "1" while the
  // user is still in the middle of entering a number. External changes
  // always win — keeps the input and slider visually in lockstep.
  useEffect(() => {
    if (!focused || !isNumber) return;
    const asNum = Number(buffer);
    if (!Number.isFinite(asNum) || Math.abs(asNum - Number(props.value)) > 1e-9) {
      setBuffer(formatDisplay(Number(props.value)));
    }
    // `buffer` intentionally omitted: we only sync when props.value changes,
    // not on every keystroke — that would overwrite the user's in-flight typing.
  }, [props.value, focused, isNumber]);

  // Slider snap: Shift = 10× finer, Alt = 10× coarser. The slider element
  // can't intercept modifier state cleanly via its own onChange, so we
  // listen on keydown at the window during a drag. Cheap + no library.
  const [snapMultiplier, setSnapMultiplier] = useState(1);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.shiftKey) setSnapMultiplier(0.1);
      else if (ev.altKey) setSnapMultiplier(10);
      else setSnapMultiplier(1);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-neutral-400">{props.label}</span>
        <span className="flex items-center gap-1">
          <input
            type={props.type ?? (isNumber ? 'number' : 'text')}
            step="any"
            value={displayValue}
            onFocus={(e) => {
              setBuffer(e.target.value);
              setFocused(true);
            }}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setBuffer(e.target.value);
              props.onChange(isNumber ? Number(e.target.value) : e.target.value);
            }}
            className="w-24 rounded border border-white/10 bg-surface-0 px-2 py-1 text-right text-neutral-100 outline-none focus:border-white/30"
          />
          {props.suffix && <span className="w-6 text-left text-neutral-500">{props.suffix}</span>}
        </span>
      </span>
      {hasSlider && (
        <div className="flex items-center gap-1">
          <input
            type="range"
            min={props.min}
            max={props.max}
            step={baseStep * snapMultiplier}
            value={clampForSlider(Number(props.value), props.min!, props.max!)}
            onChange={(e) => props.onChange(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-sky-400"
            aria-label={`${props.label} slider`}
            title={
              snapMultiplier === 1
                ? `Step ${baseStep} — hold Shift for finer, Alt for coarser`
                : `Step ${(baseStep * snapMultiplier).toPrecision(2)}`
            }
          />
          <span className="w-10 text-right text-[10px] text-neutral-500 tabular-nums">
            ±{formatDisplay(baseStep * snapMultiplier)}
          </span>
        </div>
      )}
    </label>
  );
}

function clampForSlider(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/** Rounds for display without trailing-zero noise. Keeps 4 significant
 *  digits for non-integer values, integers stay exact. */
function formatDisplay(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return String(v);
  const abs = Math.abs(v);
  // Choose decimal places so the shown value has ~4 significant figures,
  // bounded to [1, 4] so huge/tiny values don't explode.
  const sigDigits = 4;
  const magnitude = abs >= 1 ? Math.floor(Math.log10(abs)) + 1 : 1;
  const decimals = Math.max(1, Math.min(4, sigDigits - magnitude));
  const rounded = Number(v.toFixed(decimals));
  return String(rounded);
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

function ColorField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  resetLabel: string;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-neutral-400">{props.label}</span>
      <span className="flex items-center gap-1">
        <input
          type="color"
          value={props.value || '#5cc8ff'}
          onChange={(e) => props.onChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
        />
        {props.value !== '' && (
          <button
            type="button"
            onClick={() => props.onChange('')}
            title={props.resetLabel}
            className="rounded px-1 text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
          >
            ×
          </button>
        )}
      </span>
    </label>
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
