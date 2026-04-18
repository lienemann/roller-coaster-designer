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
    velocity: string;
    time: string;
    force: string;
    velocityAxis: string;
  };
}

const SERIES_COLORS = {
  normal: '#5cc8ff',
  lateral: '#ff9f5c',
  velocity: '#9ef1b9',
} as const;

interface LiveValues {
  readonly t: number | null;
  readonly normal: number | null;
  readonly lateral: number | null;
  readonly velocity: number | null;
}

const EMPTY_VALUES: LiveValues = { t: null, normal: null, lateral: null, velocity: null };

/**
 * uPlot value-over-time chart. Section-start markers (thin vertical lines)
 * and per-section colours are optional and drawn through a custom plugin.
 *
 * Value units: g-force (dimensionless multiples of F_G). Time units: seconds
 * along the integrated path — cumulativeTime[i] = i / F_HZ.
 *
 * uPlot's built-in DOM legend is disabled; we draw a compact floating
 * legend inside the chart's top-left instead. It stays readable on narrow
 * (phone) widths where the stock legend wraps to two lines and eats half
 * the graph height.
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
          // Skip the first marker (t=0) — it sits on the axis.
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
      scales: { x: { time: false }, g: {}, v: {} },
      axes: [
        {
          stroke: '#a3a3a3',
          grid: { stroke: '#1f1f1f' },
          size: 28,
        },
        { scale: 'g', stroke: '#a3a3a3', grid: { stroke: '#1f1f1f' }, size: 32 },
        {
          scale: 'v',
          side: 1,
          stroke: '#a3a3a3',
          grid: { show: false },
          size: 32,
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
          label: label.velocity,
          scale: 'v',
          stroke: SERIES_COLORS.velocity,
          width: 1.25,
          dash: [4, 3],
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
              velocity: u.data[3]?.[idx] ?? null,
            });
          },
        ],
      },
    };

    const x = Array.from(track.cumulativeTime);
    const n = Array.from(track.forceNormal);
    const l = Array.from(track.forceLateral);
    const v = Array.from(track.velocity);
    const plot = new uPlot(opts, [x, n, l, v], host);
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
      <FloatingLegend live={live} />
    </div>
  );
}

function FloatingLegend({ live }: { live: LiveValues }): JSX.Element {
  const fmt = (v: number | null, digits: number, unit: string): string =>
    v == null ? '—' : `${v.toFixed(digits)}${unit}`;
  return (
    <div
      aria-hidden="false"
      className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap items-center gap-x-2 gap-y-0 rounded bg-black/55 px-1.5 py-0.5 text-[11px] leading-tight text-neutral-200 backdrop-blur-sm"
    >
      <span className="text-neutral-400">t</span>
      <span className="tabular-nums">{fmt(live.t, 2, 's')}</span>
      <Swatch color={SERIES_COLORS.normal} />
      <span className="tabular-nums">{fmt(live.normal, 2, 'g')}</span>
      <Swatch color={SERIES_COLORS.lateral} />
      <span className="tabular-nums">{fmt(live.lateral, 2, 'g')}</span>
      <Swatch color={SERIES_COLORS.velocity} />
      <span className="tabular-nums">{fmt(live.velocity, 1, 'm/s')}</span>
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
