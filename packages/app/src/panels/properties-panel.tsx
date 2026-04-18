// SPDX-License-Identifier: AGPL-3.0-only

import { SecType, type Section } from '@roller-coaster-designer/core';
import { useMemo } from 'react';
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
      />
      <Field
        label={t('properties.yaw')}
        value={radToDeg(section.yaw)}
        onChange={(v) => patch({ yaw: degToRad(asNumber(v)) })}
        suffix="°"
      />
      <Field
        label={t('properties.roll')}
        value={radToDeg(section.roll)}
        onChange={(v) => patch({ roll: degToRad(asNumber(v)) })}
        suffix="°"
      />
      <Field
        label={t('properties.speed')}
        value={section.speed}
        onChange={(v) => patch({ speed: asNumber(v) })}
        suffix="m/s"
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

function CurvedFields({
  section,
  patch,
  t,
}: {
  section: Extract<Section, { type: SecType.Curved }>;
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
      <Field
        label={t('properties.pitchRate')}
        value={radToDeg(section.pitchRate)}
        onChange={(v) => patch({ pitchRate: degToRad(asNumber(v)) })}
        suffix="°/m"
      />
      <Field
        label={t('properties.yawRate')}
        value={radToDeg(section.yawRate)}
        onChange={(v) => patch({ yawRate: degToRad(asNumber(v)) })}
        suffix="°/m"
      />
      <Field
        label={t('properties.leadIn')}
        value={section.leadIn}
        onChange={(v) => patch({ leadIn: Math.max(0, asNumber(v)) })}
        suffix="m"
      />
      <Field
        label={t('properties.leadOut')}
        value={section.leadOut}
        onChange={(v) => patch({ leadOut: Math.max(0, asNumber(v)) })}
        suffix="m"
      />
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

// --- generic input widgets -------------------------------------------------

function Field(props: {
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  type?: 'text' | 'number';
  suffix?: string;
}): JSX.Element {
  const isNumber = typeof props.value === 'number';
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
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
    </label>
  );
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
