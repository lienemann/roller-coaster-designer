// SPDX-License-Identifier: AGPL-3.0-only

import { type TrackStream } from '@roller-coaster-designer/worker';
import { useEffect, useRef } from 'react';
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

// uPlot draws its legend as a DOM row inside the host div, below the canvas.
// We pass uPlot a smaller height so canvas + legend together fit inside the
// host's CSS box; otherwise the legend overflows and gets clipped by the
// parent's overflow:hidden. One row for live values + ~10 px padding.
const LEGEND_RESERVED_PX = 40;

/**
 * uPlot value-over-time chart. Section-start markers (thin vertical lines)
 * and per-section colours are optional and drawn through a custom plugin.
 *
 * Value units: g-force (dimensionless multiples of F_G). Time units: seconds
 * along the integrated path — cumulativeTime[i] = i / F_HZ.
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
    const chartHeight = Math.max(60, hostHeight - LEGEND_RESERVED_PX);

    const plugin: Plugin = {
      hooks: {
        draw: (u: uPlot) => {
          if (!sectionStartTimes || sectionStartTimes.length === 0) return;
          const ctx = u.ctx;
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          // Skip the first marker (t=0, the anchor) — it's right at the axis.
          for (let i = 1; i < sectionStartTimes.length; i += 1) {
            const t = sectionStartTimes[i]!;
            const x = u.valToPos(t, 'x', true);
            if (!Number.isFinite(x)) continue;
            ctx.strokeStyle = sectionColors?.[i] ?? '#ffffff55';
            ctx.globalAlpha = 0.45;
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
      height: chartHeight,
      scales: { x: { time: false }, g: {}, v: {} },
      axes: [
        { stroke: '#a3a3a3', grid: { stroke: '#262626' }, label: label.time },
        { scale: 'g', stroke: '#a3a3a3', grid: { stroke: '#262626' }, label: label.force },
        {
          scale: 'v',
          side: 1,
          stroke: '#a3a3a3',
          grid: { show: false },
          label: label.velocityAxis,
        },
      ],
      series: [
        { label: label.time, value: (_u, v) => (v == null ? '' : v.toFixed(2) + ' s') },
        {
          label: label.forceNormal,
          scale: 'g',
          stroke: '#5cc8ff',
          width: 1.25,
          value: (_u, v) => (v == null ? '' : v.toFixed(2) + ' g'),
        },
        {
          label: label.forceLateral,
          scale: 'g',
          stroke: '#ff9f5c',
          width: 1.25,
          value: (_u, v) => (v == null ? '' : v.toFixed(2) + ' g'),
        },
        {
          label: label.velocity,
          scale: 'v',
          stroke: '#9ef1b9',
          width: 1.25,
          dash: [4, 3],
          value: (_u, v) => (v == null ? '' : v.toFixed(1) + ' m/s'),
        },
      ],
      legend: { show: true, live: true },
      plugins: [plugin],
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
      plot.setSize({ width: w, height: Math.max(60, h - LEGEND_RESERVED_PX) });
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

  return <div ref={hostRef} className="h-full w-full" />;
}
