// SPDX-License-Identifier: AGPL-3.0-only

import {
  type BezierKnotDoc,
  type FuncDoc,
  type SectionDoc,
  type TrackDoc,
} from '@roller-coaster-designer/core';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '../state/store.js';

type Translate = (key: string, opts?: Record<string, unknown>) => string;
type Patcher = (patch: Partial<SectionDoc>) => void;

/**
 * Right-rail editor. Field names and units are FVD++-native: lengths in
 * metres, angles in degrees, section durations in F_HZ ticks (edited as
 * seconds), roll-func values in °/s. The anchor is track-level data and
 * gets its own editor when the pinned anchor row is selected.
 */
export function PropertiesPanel(): JSX.Element {
  const { t: tRaw } = useTranslation('common');
  const t = tRaw as unknown as Translate;
  const selected = useAppStore((s) => s.selectedSection);
  const project = useAppStore((s) => s.project);
  const patch = useAppStore((s) => s.patchSelectedSection);
  const patchTrack = useAppStore((s) => s.patchTrack);

  const track = project?.tracks[0] ?? null;
  const section = useMemo(() => {
    if (!track || typeof selected !== 'number') return null;
    return track.sections[selected] ?? null;
  }, [track, selected]);

  if (!track || selected === null) {
    return (
      <div className="flex h-full flex-col gap-2">
        <header className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {t('panels.properties')}
        </header>
        <p className="text-xs text-neutral-500">{t('properties.empty')}</p>
      </div>
    );
  }

  if (selected === 'anchor') {
    return (
      <div className="flex h-full flex-col gap-3">
        <header className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {t('sections.anchor')}
        </header>
        <AnchorFields track={track} patchTrack={patchTrack} t={t} />
      </div>
    );
  }

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

      {section.kind === 'straight' && <StraightFields section={section} patch={patch} t={t} />}
      {section.kind === 'curved' && <CurvedFields section={section} patch={patch} t={t} />}
      {(section.kind === 'forced' || section.kind === 'geometric') && (
        <TimedFields section={section} patch={patch} t={t} />
      )}
      {section.kind === 'bezier' && <BezierFields section={section} patch={patch} t={t} />}
      {section.kind === 'closure' && (
        <p className="text-xs text-neutral-500">{t('properties.closureNote')}</p>
      )}
    </div>
  );
}

// ----- anchor (track-level) ------------------------------------------------

function AnchorFields({
  track,
  patchTrack,
  t,
}: {
  track: TrackDoc;
  patchTrack: (patch: Partial<TrackDoc>) => void;
  t: Translate;
}): JSX.Element {
  return (
    <>
      <Vec3Field
        label={t('properties.position')}
        value={track.startPos}
        onChange={(v) => patchTrack({ startPos: v })}
      />
      <Field
        label={t('properties.pitch')}
        value={track.startPitch}
        suffix="°"
        step={1}
        onChange={(v) => patchTrack({ startPitch: asNumber(v) })}
      />
      <Field
        label={t('properties.yaw')}
        value={track.startYaw}
        suffix="°"
        step={1}
        onChange={(v) => patchTrack({ startYaw: asNumber(v) })}
      />
      <Field
        label={t('properties.roll')}
        value={track.anchor.roll}
        suffix="°"
        step={1}
        onChange={(v) => patchTrack({ anchor: { ...track.anchor, roll: asNumber(v) } })}
      />
      <Field
        label={t('properties.speed')}
        value={track.anchor.vel}
        suffix="m/s"
        min={0.1}
        step={0.5}
        onChange={(v) => patchTrack({ anchor: { ...track.anchor, vel: Math.max(0.1, asNumber(v)) } })}
      />
      <Field
        label={t('properties.heart')}
        value={track.heart}
        suffix="m"
        step={0.1}
        onChange={(v) => patchTrack({ heart: asNumber(v) })}
      />
      <Field
        label={t('properties.friction')}
        value={track.friction}
        step={0.005}
        onChange={(v) => patchTrack({ friction: asNumber(v) })}
      />
      <Field
        label={t('properties.resistance')}
        value={track.resistance}
        step={0.00001}
        onChange={(v) => patchTrack({ resistance: asNumber(v) })}
      />
    </>
  );
}

// ----- per-kind fields -------------------------------------------------------

/** Scale every subfunc span of a func so its total argument range becomes
 *  [0, newMax]. Used when fHLength / fAngle changes. */
function rescaleFunc(func: FuncDoc, newMax: number): FuncDoc {
  const oldMax = func.subfuncs[func.subfuncs.length - 1]?.maxArgument ?? 0;
  if (oldMax <= 0 || newMax <= 0) {
    return {
      subfuncs: func.subfuncs.map((sf, i) =>
        i === func.subfuncs.length - 1 ? { ...sf, maxArgument: newMax } : sf,
      ),
    };
  }
  const k = newMax / oldMax;
  return {
    subfuncs: func.subfuncs.map((sf) => ({
      ...sf,
      minArgument: sf.minArgument * k,
      maxArgument: sf.maxArgument * k,
    })),
  };
}

function StraightFields({
  section,
  patch,
  t,
}: {
  section: Extract<SectionDoc, { kind: 'straight' }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  return (
    <>
      <Field
        label={t('properties.length')}
        value={section.fHLength}
        suffix="m"
        min={0.1}
        step={1}
        onChange={(v) => {
          const len = Math.max(0.1, asNumber(v));
          patch({ fHLength: len, rollFunc: rescaleFunc(section.rollFunc, len) });
        }}
      />
      <SpeedFields section={section} patch={patch} t={t} />
    </>
  );
}

function CurvedFields({
  section,
  patch,
  t,
}: {
  section: Extract<SectionDoc, { kind: 'curved' }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  return (
    <>
      <Field
        label={t('properties.fAngle')}
        value={section.fAngle}
        suffix="°"
        min={1}
        step={5}
        onChange={(v) => {
          const angle = Math.max(1, asNumber(v));
          patch({ fAngle: angle, rollFunc: rescaleFunc(section.rollFunc, angle) });
        }}
      />
      <Field
        label={t('properties.fRadius')}
        value={section.fRadius}
        suffix="m"
        min={1}
        step={1}
        onChange={(v) => patch({ fRadius: Math.max(1, asNumber(v)) })}
      />
      <Field
        label={t('properties.fDirection')}
        value={section.fDirection}
        suffix="°"
        step={5}
        onChange={(v) => patch({ fDirection: asNumber(v) })}
      />
      <p className="text-[11px] text-neutral-500">{t('properties.fDirectionHint')}</p>
      <Field
        label={t('properties.fLeadIn')}
        value={section.fLeadIn}
        suffix="°"
        min={0}
        step={1}
        onChange={(v) => patch({ fLeadIn: Math.max(0, asNumber(v)) })}
      />
      <Field
        label={t('properties.fLeadOut')}
        value={section.fLeadOut}
        suffix="°"
        min={0}
        step={1}
        onChange={(v) => patch({ fLeadOut: Math.max(0, asNumber(v)) })}
      />
      <SpeedFields section={section} patch={patch} t={t} />
    </>
  );
}

function TimedFields({
  section,
  patch,
  t,
}: {
  section: Extract<SectionDoc, { kind: 'forced' | 'geometric' }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  return (
    <>
      <Field
        label={t('properties.duration')}
        value={section.iTime / 1000}
        suffix={section.bArgument ? 'm' : 's'}
        min={0.01}
        step={0.1}
        onChange={(v) => {
          const seconds = Math.max(0.01, asNumber(v));
          const max = seconds;
          patch({
            iTime: Math.round(seconds * 1000),
            rollFunc: rescaleFunc(section.rollFunc, max),
            normForce: rescaleFunc(section.normForce, max),
            latForce: rescaleFunc(section.latForce, max),
          });
        }}
      />
      <ToggleField
        label={t('properties.bOrientation')}
        value={section.bOrientation}
        onLabel="Euler"
        offLabel="Quaternion"
        onChange={(v) => patch({ bOrientation: v })}
      />
      <SpeedFields section={section} patch={patch} t={t} />
    </>
  );
}

function BezierFields({
  section,
  patch,
  t,
}: {
  section: Extract<SectionDoc, { kind: 'bezier' }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  const setKnot = (i: number, knot: BezierKnotDoc): void => {
    const knots = [...section.knots];
    knots[i] = knot;
    patch({ knots });
  };
  return (
    <>
      {section.knots.map((k, i) => (
        <div key={i} className="flex flex-col gap-1 rounded bg-surface-2 p-2">
          <span className="text-[11px] font-semibold text-neutral-400">
            {t('properties.knot', { index: i + 1 })}
          </span>
          <Vec3Field
            label="P"
            value={k.P1}
            onChange={(v) => {
              // Move handles together with the knot.
              const dx = v[0] - k.P1[0];
              const dy = v[1] - k.P1[1];
              const dz = v[2] - k.P1[2];
              setKnot(i, {
                ...k,
                P1: v,
                Kp1: [k.Kp1[0] + dx, k.Kp1[1] + dy, k.Kp1[2] + dz],
                Kp2: [k.Kp2[0] + dx, k.Kp2[1] + dy, k.Kp2[2] + dz],
              });
            }}
          />
          <Field
            label={t('properties.roll')}
            value={(k.roll * 180) / Math.PI}
            suffix="°"
            step={5}
            onChange={(v) => setKnot(i, { ...k, roll: (asNumber(v) * Math.PI) / 180 })}
          />
          <div className="flex gap-3 text-[11px] text-neutral-400">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={k.contRoll}
                onChange={(e) => setKnot(i, { ...k, contRoll: e.target.checked })}
              />
              contRoll
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={k.relRoll}
                onChange={(e) => setKnot(i, { ...k, relRoll: e.target.checked })}
              />
              relRoll
            </label>
          </div>
        </div>
      ))}
    </>
  );
}

function SpeedFields({
  section,
  patch,
  t,
}: {
  section: Extract<SectionDoc, { kind: 'straight' | 'curved' | 'forced' | 'geometric' }>;
  patch: Patcher;
  t: Translate;
}): JSX.Element {
  return (
    <>
      <ToggleField
        label={t('properties.bSpeed')}
        value={section.bSpeed}
        onLabel={t('properties.speedEnergy')}
        offLabel={t('properties.speedHeld')}
        onChange={(v) => patch({ bSpeed: v })}
      />
      {!section.bSpeed && (
        <Field
          label={t('properties.fVel')}
          value={section.fVel}
          suffix="m/s"
          min={0.1}
          step={0.5}
          onChange={(v) => patch({ fVel: Math.max(0.1, asNumber(v)) })}
        />
      )}
    </>
  );
}

// ----- primitive fields ------------------------------------------------------

function asNumber(v: string | number): number {
  if (typeof v === 'number') return v;
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function Field(props: {
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  type?: 'text' | 'number';
  suffix?: string;
  min?: number;
  step?: number;
}): JSX.Element {
  const isText = props.type === 'text';
  const [buffer, setBuffer] = useState(String(props.value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setBuffer(isText ? String(props.value) : formatNum(props.value));
  }, [props.value, focused, isText]);

  return (
    <label className="flex items-center gap-2 text-xs text-neutral-300">
      <span className="w-24 shrink-0 text-neutral-400">{props.label}</span>
      <input
        type="text"
        inputMode={isText ? undefined : 'decimal'}
        value={buffer}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          props.onChange(isText ? buffer : asNumber(buffer));
        }}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-full min-w-0 rounded bg-surface-2 px-1.5 py-0.5 text-right tabular-nums text-neutral-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-400"
      />
      {props.suffix && <span className="w-8 shrink-0 text-neutral-500">{props.suffix}</span>}
    </label>
  );
}

function formatNum(v: string | number): string {
  if (typeof v === 'string') return v;
  return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, '');
}

function Vec3Field(props: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 text-xs text-neutral-300">
      <span className="w-24 shrink-0 text-neutral-400">{props.label}</span>
      {[0, 1, 2].map((axis) => (
        <input
          key={axis}
          type="text"
          inputMode="decimal"
          defaultValue={formatNum(props.value[axis]!)}
          onBlur={(e) => {
            const next: [number, number, number] = [...props.value];
            next[axis] = asNumber(e.target.value);
            props.onChange(next);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-full min-w-0 rounded bg-surface-2 px-1 py-0.5 text-right tabular-nums text-neutral-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-400"
        />
      ))}
    </div>
  );
}

function ToggleField(props: {
  label: string;
  value: boolean;
  onLabel: string;
  offLabel: string;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-300">
      <span className="w-24 shrink-0 text-neutral-400">{props.label}</span>
      <div className="flex overflow-hidden rounded ring-1 ring-white/10">
        <button
          type="button"
          onClick={() => props.onChange(true)}
          className={`px-2 py-0.5 ${props.value ? 'bg-sky-400/25 text-sky-100' : 'bg-surface-2 text-neutral-400 hover:bg-white/10'}`}
        >
          {props.onLabel}
        </button>
        <button
          type="button"
          onClick={() => props.onChange(false)}
          className={`px-2 py-0.5 ${!props.value ? 'bg-sky-400/25 text-sky-100' : 'bg-surface-2 text-neutral-400 hover:bg-white/10'}`}
        >
          {props.offLabel}
        </button>
      </div>
    </div>
  );
}
