// SPDX-License-Identifier: AGPL-3.0-only

import { type TrackStream } from '@roller-coaster-designer/worker';
import { useEffect, useRef } from 'react';
import uPlot, { type Options as UPlotOptions } from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ForcesGraphProps {
  readonly track: TrackStream | null;
  readonly label: { forceNormal: string; forceLateral: string; time: string; force: string };
}

/**
 * uPlot value-over-time chart for the two sampled force columns. Rebuilds
 * the uPlot instance when the track reference changes so we never `setData`
 * a buffer that's shorter than the chart thinks it is.
 *
 * Value units: g-force (dimensionless multiples of F_G). Time units: seconds
 * along the integrated path — cumulativeTime[i] = i / F_HZ.
 */
export function ForcesGraph({ track, label }: ForcesGraphProps): JSX.Element {
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

    const opts: UPlotOptions = {
      width: host.clientWidth || 600,
      height: host.clientHeight || 160,
      scales: { x: { time: false } },
      axes: [
        { stroke: '#a3a3a3', grid: { stroke: '#262626' }, label: label.time },
        { stroke: '#a3a3a3', grid: { stroke: '#262626' }, label: label.force },
      ],
      series: [
        { label: label.time, value: (_u, v) => (v == null ? '' : v.toFixed(2) + ' s') },
        {
          label: label.forceNormal,
          stroke: '#5cc8ff',
          width: 1.25,
          value: (_u, v) => (v == null ? '' : v.toFixed(2) + ' g'),
        },
        {
          label: label.forceLateral,
          stroke: '#ff9f5c',
          width: 1.25,
          value: (_u, v) => (v == null ? '' : v.toFixed(2) + ' g'),
        },
      ],
      legend: { show: true, live: true },
    };

    // uPlot wants plain number arrays for each series. Stride the Float32Arrays
    // into tuples on construction; subsequent resizes just recreate the plot.
    const x = Array.from(track.cumulativeTime);
    const n = Array.from(track.forceNormal);
    const l = Array.from(track.forceLateral);
    const plot = new uPlot(opts, [x, n, l], host);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: host.clientWidth, height: host.clientHeight });
    });
    ro.observe(host);
    roRef.current = ro;

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
      roRef.current = null;
    };
  }, [track, label]);

  if (!track || track.nodeCount < 2) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
        {/* Placeholder. Real empty-state illustration lands with M8 preferences. */}
        <span>—</span>
      </div>
    );
  }

  return <div ref={hostRef} className="h-full w-full" />;
}
