// SPDX-License-Identifier: AGPL-3.0-only

import { type TrackStream } from '@roller-coaster-designer/worker';
import { useEffect, useRef, useState } from 'react';
import uPlot, { type Options as UPlotOptions, type Plugin } from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ForcesGraphProps {
  readonly track: TrackStream | null;
  /** Seconds at which each section begins; drawn as vertical markers. */
  readonly sectionStartTimes?: readonly number[];
  /** Colour hex per section (same order as sectionStartTimes + 1). */
  readonly sectionColors?: readonly string[];
  readonly label: {
    forceNormal: string;
    forceLateral: string;
    forceLong: string;
    forceNormalShort: string;
    forceLateralShort: string;
    forceLongShort: string;
    velocity: string;
    velocityShort: string;
    rollSpeed: string;
    rollSpeedShort: string;
    rollSpeedAxis: string;
    time: string;
    timeShort: string;
    force: string;
    velocityAxis: string;
  };
}

const RAD_TO_DEG = 180 / Math.PI;

const SERIES_COLORS = {
  normal: '#5cc8ff',
  lateral: '#ff9f5c',
  long: '#d7a7ff',
  velocity: '#9ef1b9',
  rollSpeed: '#f7d76a',
} as const;

interface LiveValues {
  readonly t: number | null;
  readonly normal: number | null;
  readonly lateral: number | null;
  readonly long: number | null;
  readonly velocity: number | null;
  readonly rollSpeed: number | null;
}

const EMPTY_VALUES: LiveValues = {
  t: null,
  normal: null,
  lateral: null,
  long: null,
  velocity: null,
  rollSpeed: null,
};

/**
 * uPlot value-over-time chart. Three rider-frame force components (normal,
 * lateral, longitudinal) on a g-scale plus velocity on a secondary m/s axis.
 * Section-start markers (thin vertical lines) and per-section colours are
 * optional and drawn through a custom plugin.
 *
 * uPlot's built-in DOM legend is disabled; we draw a compact floating
 * legend inside the chart's top-left with short labels and live cursor
 * values. It stays readable on narrow (phone) widths where the stock legend
 * wraps and eats half the graph height.
 */
export function ForcesGraph({
  track,
  sectionStartTimes,
  sectionColors,
  label,
}: ForcesGraphProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [live, setLive] = useState<LiveValues>(EMPTY_VALUES);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    if (plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }

    if (!track || track.nodeCount < 2) return undefined;

    const hostWidth = host.clientWidth || 600;
    const hostHeight = host.clientHeight || 200;

    const plugin: Plugin = {
      hooks: {
        draw: (u: uPlot) => {
          if (!sectionStartTimes || sectionStartTimes.length === 0) return;
          const ctx = u.ctx;
          ctx.save();
          ctx.setLineDash([2, 4]);
          ctx.lineWidth = 1;
          for (let i = 1; i < sectionStartTimes.length; i += 1) {
            const t = sectionStartTimes[i]!;
            const x = u.valToPos(t, 'x', true);
            if (!Number.isFinite(x)) continue;
            ctx.strokeStyle = sectionColors?.[i] ?? '#ffffff33';
            ctx.globalAlpha = 0.22;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
          }
          ctx.restore();
        },
      },
    };

    const opts: UPlotOptions = {
      width: hostWidth,
      height: hostHeight,
      scales: { x: { time: false }, g: {}, v: {}, rs: {} },
      axes: [
        {
          stroke: '#a3a3a3',
          grid: { stroke: '#1f1f1f' },
          size: 28,
          label: label.time,
          labelSize: 16,
          labelFont: '11px system-ui, sans-serif',
          labelGap: 2,
        },
        {
          scale: 'g',
          stroke: '#a3a3a3',
          grid: { stroke: '#1f1f1f' },
          size: 44,
          label: label.force,
          labelSize: 14,
          labelFont: '11px system-ui, sans-serif',
          labelGap: 2,
        },
        {
          scale: 'v',
          side: 1,
          stroke: '#a3a3a3',
          grid: { show: false },
          size: 44,
          label: label.velocityAxis,
          labelSize: 14,
          labelFont: '11px system-ui, sans-serif',
          labelGap: 2,
        },
        {
          scale: 'rs',
          side: 1,
          stroke: '#a3a3a3',
          grid: { show: false },
          size: 44,
          label: label.rollSpeedAxis,
          labelSize: 14,
          labelFont: '11px system-ui, sans-serif',
          labelGap: 2,
        },
      ],
      series: [
        { label: label.time },
        {
          label: label.forceNormal,
          scale: 'g',
          stroke: SERIES_COLORS.normal,
          width: 1.25,
        },
        {
          label: label.forceLateral,
          scale: 'g',
          stroke: SERIES_COLORS.lateral,
          width: 1.25,
        },
        {
          label: label.forceLong,
          scale: 'g',
          stroke: SERIES_COLORS.long,
          width: 1.25,
        },
        {
          label: label.velocity,
          scale: 'v',
          stroke: SERIES_COLORS.velocity,
          width: 1.25,
          dash: [4, 3],
        },
        {
          label: label.rollSpeed,
          scale: 'rs',
          stroke: SERIES_COLORS.rollSpeed,
          width: 1.25,
          dash: [1, 3],
        },
      ],
      legend: { show: false },
      plugins: [plugin],
      cursor: {
        points: { size: 6 },
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null) {
              setLive(EMPTY_VALUES);
              return;
            }
            setLive({
              t: u.data[0]?.[idx] ?? null,
              normal: u.data[1]?.[idx] ?? null,
              lateral: u.data[2]?.[idx] ?? null,
              long: u.data[3]?.[idx] ?? null,
              velocity: u.data[4]?.[idx] ?? null,
              rollSpeed: u.data[5]?.[idx] ?? null,
            });
          },
        ],
      },
    };

    const x = Array.from(track.cumulativeTime);
    const n = Array.from(track.forceNormal);
    const l = Array.from(track.forceLateral);
    const a = Array.from(track.forceLong);
    const v = Array.from(track.velocity);
    // Banking speed comes off the worker in rad/s; display in deg/s.
    const rs = Array.from(track.rollSpeed, (r) => r * RAD_TO_DEG);
    const plot = new uPlot(opts, [x, n, l, a, v, rs], host);
    plotRef.current = plot;

    let lastWidth = hostWidth;
    let lastHeight = hostHeight;
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 2 || h < 2) return;
      if (Math.abs(w - lastWidth) < 1 && Math.abs(h - lastHeight) < 1) return;
      lastWidth = w;
      lastHeight = h;
      plot.setSize({ width: w, height: h });
    });
    ro.observe(host);
    roRef.current = ro;

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
      roRef.current = null;
    };
  }, [track, label, sectionStartTimes, sectionColors]);

  if (!track || track.nodeCount < 2) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
        <span>—</span>
      </div>
    );
  }

  return (
    <div ref={hostRef} className="relative h-full w-full">
      <FloatingLegend live={live} label={label} />
    </div>
  );
}

function FloatingLegend({
  live,
  label,
}: {
  live: LiveValues;
  label: ForcesGraphProps['label'];
}): JSX.Element {
  const fmt = (v: number | null, digits: number, unit: string): string =>
    v == null ? '—' : `${v.toFixed(digits)}${unit}`;
  return (
    <div
      aria-hidden="false"
      className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap items-center gap-x-2 gap-y-0 rounded bg-black/55 px-1.5 py-0.5 text-[11px] leading-tight text-neutral-200 backdrop-blur-sm"
    >
      <span className="text-neutral-400">{label.timeShort}</span>
      <span className="tabular-nums">{fmt(live.t, 2, 's')}</span>
      <Swatch color={SERIES_COLORS.normal} />
      <span className="text-neutral-400" title={label.forceNormal}>
        {label.forceNormalShort}
      </span>
      <span className="tabular-nums">{fmt(live.normal, 2, 'g')}</span>
      <Swatch color={SERIES_COLORS.lateral} />
      <span className="text-neutral-400" title={label.forceLateral}>
        {label.forceLateralShort}
      </span>
      <span className="tabular-nums">{fmt(live.lateral, 2, 'g')}</span>
      <Swatch color={SERIES_COLORS.long} />
      <span className="text-neutral-400" title={label.forceLong}>
        {label.forceLongShort}
      </span>
      <span className="tabular-nums">{fmt(live.long, 2, 'g')}</span>
      <Swatch color={SERIES_COLORS.velocity} />
      <span className="text-neutral-400" title={label.velocity}>
        {label.velocityShort}
      </span>
      <span className="tabular-nums">{fmt(live.velocity, 1, 'm/s')}</span>
      <Swatch color={SERIES_COLORS.rollSpeed} />
      <span className="text-neutral-400" title={label.rollSpeed}>
        {label.rollSpeedShort}
      </span>
      <span className="tabular-nums">{fmt(live.rollSpeed, 0, '°/s')}</span>
    </div>
  );
}

function Swatch({ color }: { color: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-3 rounded-sm"
      style={{ backgroundColor: color }}
    />
  );
}
