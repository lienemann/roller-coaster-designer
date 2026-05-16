// SPDX-License-Identifier: AGPL-3.0-only

import { SecType, firstCubicOf, replaceFirstCubic } from '@roller-coaster-designer/core';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ForcesGraph } from './graphs/forces-graph.js';
import { PropertiesPanel } from './panels/properties-panel.js';
import { SectionsPanel } from './panels/sections-panel.js';
import { sectionColor } from './scene/section-colors.js';
import { Viewport, type CameraMode, type Projection, type RenderStyle } from './scene/viewport.js';
import { useAppStore } from './state/store.js';
import { LanguageSwitcher } from './ui/language-switcher.js';
import { MenuBar } from './ui/menu-bar.js';
import { Splitter } from './ui/splitter.js';
import { useMediaQuery } from './ui/use-media-query.js';
import { useRecomputeOnProjectChange } from './worker/use-recompute.js';

type MobileTab = 'sections' | 'properties';

// Bump the desktop threshold above typical phone landscape widths (720px
// on modern phones) so portrait + landscape both use a mobile layout.
// Tablets (iPad at 1024 and up) still get the three-column grid.
const DESKTOP_QUERY = '(min-width: 1024px)';
// Below desktop, pick a wide-short layout when the device is landscape
// (viewport left, panels right) vs. the default stacked vertical one
// (portrait phones + narrow windows).
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-width: 1023px)';

export function App(): JSX.Element {
  const { t } = useTranslation('common');
  const project = useAppStore((s) => s.project);
  const projectName = useAppStore((s) => s.projectName);
  const isDirty = useAppStore((s) => s.isDirty);
  const tracks = useAppStore((s) => s.tracks);
  const selectedSectionIndex = useAppStore((s) => s.selectedSectionIndex);
  const selectSection = useAppStore((s) => s.selectSection);
  const patchSelectedSection = useAppStore((s) => s.patchSelectedSection);
  const environment = useAppStore((s) => s.environment);

  useRecomputeOnProjectChange();

  const fitViewEpoch = useAppStore((s) => s.fitViewEpoch);
  const resetViewEpoch = useAppStore((s) => s.resetViewEpoch);
  const requestFitView = useAppStore((s) => s.requestFitView);
  const requestResetView = useAppStore((s) => s.requestResetView);

  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const isLandscapeMobile = useMediaQuery(LANDSCAPE_QUERY, false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('sections');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [renderStyle, setRenderStyle] = useState<RenderStyle>('tubular');
  const [projection, setProjection] = useState<Projection>('perspective');
  const [showHeartline, setShowHeartline] = useState(false);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  // Panel sizes in pixels. Splitters mutate these on drag. Defaults chosen
  // to match the pre-splitter grid fractions on a typical 1440-wide
  // desktop; users then tune to taste.
  const [leftWidthPx, setLeftWidthPx] = useState(260);
  const [rightWidthPx, setRightWidthPx] = useState(340);
  const [graphHeightPx, setGraphHeightPx] = useState(240);
  const LEFT_MIN = 160;
  const LEFT_MAX = 600;
  const RIGHT_MIN = 220;
  const RIGHT_MAX = 700;
  const GRAPH_MIN = 80;
  const GRAPH_MAX = 700;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

  // When the user picks a section on narrow layouts, flip to the Properties
  // tab so they see the edit fields immediately. Desktop shows both at once.
  useEffect(() => {
    if (!isDesktop && selectedSectionIndex !== null) {
      setMobileTab('properties');
    }
  }, [isDesktop, selectedSectionIndex]);

  const documentLabel =
    project === null
      ? t('app.noProject')
      : `${projectName ?? t('app.untitled')}${isDirty ? ' *' : ''}`;

  const firstTrack = tracks[0] ?? null;

  // Pre-compute the per-section colours + starting times for the graph's
  // section-boundary markers. Memoised so the uPlot instance doesn't rebuild
  // on every App render.
  const sectionColors = useMemo<string[]>(() => {
    const sections = project?.tracks[0]?.sections ?? [];
    return sections.map((section, idx) => section.color ?? sectionColor(idx));
  }, [project]);
  // Bezier control points for the currently-selected section, in world
  // coordinates. Null unless the selection is a Bezier — Viewport uses this
  // to show TransformControls handles.
  const bezierHandles = useMemo<
    | readonly [
        [number, number, number],
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ]
    | null
  >(() => {
    if (selectedSectionIndex === null) return null;
    const sec = project?.tracks[0]?.sections[selectedSectionIndex];
    if (sec?.type !== SecType.Bezier) return null;
    return firstCubicOf(sec);
  }, [project, selectedSectionIndex]);

  const sectionStartTimes = useMemo<number[]>(() => {
    const starts = firstTrack?.sectionStartNodes ?? [];
    const times = firstTrack?.cumulativeTime;
    if (!times) return [];
    return starts.map((nodeIndex) => times[nodeIndex] ?? 0);
  }, [firstTrack]);

  const graphLabel = {
    forceNormal: t('graphs.forceNormal'),
    forceLateral: t('graphs.forceLateral'),
    forceLong: t('graphs.forceLong'),
    forceNormalShort: t('graphs.forceNormalShort'),
    forceLateralShort: t('graphs.forceLateralShort'),
    forceLongShort: t('graphs.forceLongShort'),
    velocity: t('graphs.velocity'),
    velocityShort: t('graphs.velocityShort'),
    rollSpeed: t('graphs.rollSpeed'),
    rollSpeedShort: t('graphs.rollSpeedShort'),
    rollSpeedAxis: t('graphs.rollSpeedAxis'),
    time: t('graphs.time'),
    timeShort: t('graphs.timeShort'),
    force: t('graphs.force'),
    velocityAxis: t('graphs.velocityAxis'),
  };

  const emptyState = (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="max-w-md text-center">
        <p className="text-sm text-neutral-400">{t('app.tagline')}</p>
        <p className="mt-2 text-xs text-neutral-500">{t('status.scaffold')}</p>
        <p className="mt-4 text-xs text-neutral-500">{t('app.emptyHint')}</p>
      </div>
    </div>
  );

  const viewportContent =
    tracks.length === 0 ? (
      emptyState
    ) : (
      <>
        <Viewport
          tracks={tracks}
          sectionColors={sectionColors}
          selectedSectionIndex={selectedSectionIndex}
          cameraMode={cameraMode}
          fitEpoch={fitViewEpoch}
          resetEpoch={resetViewEpoch}
          cubeLabels={{
            top: t('viewport.cube.top'),
            bottom: t('viewport.cube.bottom'),
            front: t('viewport.cube.front'),
            back: t('viewport.cube.back'),
            left: t('viewport.cube.left'),
            right: t('viewport.cube.right'),
            rotateCw: t('viewport.cube.rotateCw'),
            rotateCcw: t('viewport.cube.rotateCcw'),
            tiltUp: t('viewport.cube.tiltUp'),
            tiltDown: t('viewport.cube.tiltDown'),
            tiltLeft: t('viewport.cube.tiltLeft'),
            tiltRight: t('viewport.cube.tiltRight'),
            home: t('viewport.cube.home'),
          }}
          onSelectSection={selectSection}
          renderStyle={renderStyle}
          onHome={requestResetView}
          projection={projection}
          showHeartline={showHeartline}
          heartOffset={project?.tracks[0]?.heart ?? 1.1}
          skyDataUri={environment.skyDataUri}
          floorDataUri={environment.floorDataUri}
          floorColor={environment.floorColor}
          floorVisible={environment.floorVisible}
          floorTileMeters={environment.floorTileMeters}
          bezierHandles={bezierHandles}
          onBezierHandleChange={(index, pos) => {
            if (!bezierHandles) return;
            if (selectedSectionIndex === null) return;
            const sec = project?.tracks[0]?.sections[selectedSectionIndex];
            if (sec?.type !== SecType.Bezier) return;
            const cps: [
              [number, number, number],
              [number, number, number],
              [number, number, number],
              [number, number, number],
            ] = [
              [...bezierHandles[0]],
              [...bezierHandles[1]],
              [...bezierHandles[2]],
              [...bezierHandles[3]],
            ];
            cps[index] = pos;
            patchSelectedSection({
              segments: replaceFirstCubic(sec.segments, cps[0], cps[1], cps[2], cps[3]),
            });
          }}
        />
        {/* Compact viewport toolbar. Stacks vertically on narrow widths
            so it never overlaps the ViewCube in the top-right corner;
            flows horizontally from sm (640 px) upward. */}
        <div
          role="toolbar"
          aria-label={t('viewport.cameraMode')}
          className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center"
        >
          {/* Camera mode: Orbit (spiral arrow) vs POV (eye). */}
          <SegmentedGroup>
            <Segment
              active={cameraMode === 'orbit'}
              onClick={() => setCameraMode('orbit')}
              svg={ORBIT_SVG}
              title={t('viewport.orbit')}
            />
            <Segment
              active={cameraMode === 'pov'}
              onClick={() => setCameraMode('pov')}
              svg={POV_SVG}
              title={t('viewport.pov')}
            />
          </SegmentedGroup>
          {/* Render style: Tubular (pipe) vs Ribbon (single line). */}
          <SegmentedGroup>
            <Segment
              active={renderStyle === 'tubular'}
              onClick={() => setRenderStyle('tubular')}
              svg={TUBULAR_SVG}
              title={t('viewport.styleTubular')}
            />
            <Segment
              active={renderStyle === 'ribbon'}
              onClick={() => setRenderStyle('ribbon')}
              svg={RIBBON_SVG}
              title={t('viewport.styleRibbon')}
            />
          </SegmentedGroup>
          {/* Projection: Perspective (converging lines) vs Ortho (parallel). */}
          <SegmentedGroup>
            <Segment
              active={projection === 'perspective'}
              onClick={() => setProjection('perspective')}
              svg={PERSP_SVG}
              title={t('viewport.persp')}
            />
            <Segment
              active={projection === 'ortho'}
              onClick={() => setProjection('ortho')}
              svg={ORTHO_SVG}
              title={t('viewport.ortho')}
            />
          </SegmentedGroup>
          <IconToggle
            active={showHeartline}
            onClick={() => setShowHeartline((v) => !v)}
            svg={HEART_SVG}
            title={t('viewport.heartline')}
          />
          {/* Fit frames the whole geometry. Home (= reset to default view)
              lives on the ViewCube's bottom-right corner, not here — one
              home icon only. */}
          <IconAction onClick={requestFitView} svg={FIT_SVG} title={t('viewport.fit')} />
        </div>
      </>
    );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-0 text-neutral-100">
      {/* Header: single-row on every width. z-40 so the MenuBar's overflow
          popover floats above the viewport canvas on narrow widths. */}
      <header className="relative z-40 flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-surface-1 px-3">
        <h1 className="shrink-0 truncate text-base font-semibold tracking-tight">
          {t('app.title')}
        </h1>
        <MenuBar />
        <span
          aria-label={t('app.currentProject')}
          title={documentLabel}
          className="min-w-0 flex-1 truncate text-right text-xs text-neutral-400"
        >
          {documentLabel}
        </span>
        <LanguageSwitcher />
      </header>

      {isDesktop ? (
        <main
          className="grid min-h-0 flex-1"
          style={{
            // 5 cols: [left rail] [splitter] [centre] [splitter] [right rail]
            // 3 rows: [viewport] [row splitter] [graph]
            gridTemplateColumns: `${sectionsCollapsed ? '32px' : `${leftWidthPx}px`} 4px minmax(300px, 1fr) 4px ${
              propertiesCollapsed ? '32px' : `${rightWidthPx}px`
            }`,
            gridTemplateRows: graphCollapsed ? '1fr 0px 32px' : `1fr 4px ${graphHeightPx}px`,
          }}
        >
          <aside
            aria-label={t('panels.sections')}
            className="flex min-h-0 flex-col overflow-hidden border-r border-white/10 bg-surface-1"
            style={{ gridColumn: 1, gridRow: '1 / span 3' }}
          >
            <RailHeader
              collapsed={sectionsCollapsed}
              onToggle={() => setSectionsCollapsed((v) => !v)}
              label={t('panels.sections')}
              expandLabel={t('panels.expand')}
              collapseLabel={t('panels.collapse')}
              side="left"
            />
            {!sectionsCollapsed && (
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <SectionsPanel />
              </div>
            )}
          </aside>
          {!sectionsCollapsed && (
            <div style={{ gridColumn: 2, gridRow: '1 / span 3' }}>
              <Splitter
                direction="vertical"
                label={t('splitter.left')}
                onDrag={(dx) => setLeftWidthPx((w) => clamp(w + dx, LEFT_MIN, LEFT_MAX))}
              />
            </div>
          )}
          <section
            aria-label="viewport"
            className="relative min-h-0 border-b border-white/10 bg-surface-0"
            style={{ gridColumn: 3, gridRow: 1 }}
          >
            {viewportContent}
          </section>
          {!graphCollapsed && (
            <div style={{ gridColumn: 3, gridRow: 2 }}>
              <Splitter
                direction="horizontal"
                label={t('splitter.graph')}
                onDrag={(dy) => setGraphHeightPx((h) => clamp(h - dy, GRAPH_MIN, GRAPH_MAX))}
              />
            </div>
          )}
          {!propertiesCollapsed && (
            <div style={{ gridColumn: 4, gridRow: '1 / span 3' }}>
              <Splitter
                direction="vertical"
                label={t('splitter.right')}
                onDrag={(dx) => setRightWidthPx((w) => clamp(w - dx, RIGHT_MIN, RIGHT_MAX))}
              />
            </div>
          )}
          <aside
            aria-label={t('panels.properties')}
            className="flex min-h-0 flex-col overflow-hidden border-l border-white/10 bg-surface-1"
            style={{ gridColumn: 5, gridRow: '1 / span 3' }}
          >
            <RailHeader
              collapsed={propertiesCollapsed}
              onToggle={() => setPropertiesCollapsed((v) => !v)}
              label={t('panels.properties')}
              expandLabel={t('panels.expand')}
              collapseLabel={t('panels.collapse')}
              side="right"
            />
            {!propertiesCollapsed && (
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <PropertiesPanel />
              </div>
            )}
          </aside>
          <footer
            aria-label={t('panels.graphs')}
            className="flex min-h-0 flex-col overflow-hidden bg-surface-2"
            style={{ gridColumn: 3, gridRow: 3 }}
          >
            <GraphHeader
              collapsed={graphCollapsed}
              onToggle={() => setGraphCollapsed((v) => !v)}
              label={t('panels.graphs')}
              expandLabel={t('panels.expand')}
              collapseLabel={t('panels.collapse')}
            />
            {!graphCollapsed && (
              <div className="min-h-0 flex-1 p-2">
                <ForcesGraph
                  track={firstTrack}
                  sectionStartTimes={sectionStartTimes}
                  sectionColors={sectionColors}
                  label={graphLabel}
                />
              </div>
            )}
          </footer>
        </main>
      ) : isLandscapeMobile ? (
        // Landscape phone / narrow landscape window: put the 3D viewport
        // + graphs on the left, panels + tabs on the right. Keeps the
        // 3D view usable instead of being squished into a tall strip.
        <main className="flex min-h-0 flex-1 flex-row">
          <div className="flex min-h-0 flex-[3] flex-col">
            <section
              aria-label="viewport"
              className="relative min-h-0 flex-[3] border-b border-white/10 bg-surface-0"
            >
              {viewportContent}
            </section>
            <div
              aria-label={t('panels.graphs')}
              className={`flex flex-col overflow-hidden bg-surface-2 ${
                graphCollapsed ? 'shrink-0' : 'min-h-0 flex-[2]'
              }`}
            >
              <GraphHeader
                collapsed={graphCollapsed}
                onToggle={() => setGraphCollapsed((v) => !v)}
                label={t('panels.graphs')}
                expandLabel={t('panels.expand')}
                collapseLabel={t('panels.collapse')}
              />
              {!graphCollapsed && (
                <div className="min-h-0 flex-1 p-2">
                  <ForcesGraph
                    track={firstTrack}
                    sectionStartTimes={sectionStartTimes}
                    sectionColors={sectionColors}
                    label={graphLabel}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-[2] flex-col border-l border-white/10">
            <div className="flex shrink-0 border-b border-white/10 bg-surface-1">
              <MobileTabButton
                active={mobileTab === 'sections'}
                onClick={() => setMobileTab('sections')}
                label={t('panels.sections')}
              />
              <MobileTabButton
                active={mobileTab === 'properties'}
                onClick={() => setMobileTab('properties')}
                label={t('panels.properties')}
              />
            </div>
            <section
              aria-label={mobileTab === 'sections' ? t('panels.sections') : t('panels.properties')}
              className="min-h-0 flex-1 overflow-auto bg-surface-1 p-3"
            >
              {mobileTab === 'sections' ? <SectionsPanel /> : <PropertiesPanel />}
            </section>
          </div>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          <section
            aria-label="viewport"
            className="relative min-h-0 flex-[3] border-b border-white/10 bg-surface-0"
          >
            {viewportContent}
          </section>
          <div
            aria-label={t('panels.graphs')}
            className={`flex flex-col overflow-hidden border-b border-white/10 bg-surface-2 ${
              graphCollapsed ? 'shrink-0' : 'min-h-0 flex-[2]'
            }`}
          >
            <GraphHeader
              collapsed={graphCollapsed}
              onToggle={() => setGraphCollapsed((v) => !v)}
              label={t('panels.graphs')}
              expandLabel={t('panels.expand')}
              collapseLabel={t('panels.collapse')}
            />
            {!graphCollapsed && (
              <div className="min-h-0 flex-1 p-2">
                <ForcesGraph
                  track={firstTrack}
                  sectionStartTimes={sectionStartTimes}
                  sectionColors={sectionColors}
                  label={graphLabel}
                />
              </div>
            )}
          </div>

          <div className="flex shrink-0 border-t border-white/10 bg-surface-1">
            <MobileTabButton
              active={mobileTab === 'sections'}
              onClick={() => setMobileTab('sections')}
              label={t('panels.sections')}
            />
            <MobileTabButton
              active={mobileTab === 'properties'}
              onClick={() => setMobileTab('properties')}
              label={t('panels.properties')}
            />
          </div>

          <section
            aria-label={mobileTab === 'sections' ? t('panels.sections') : t('panels.properties')}
            className="min-h-0 flex-[2] overflow-auto bg-surface-1 p-3"
          >
            {mobileTab === 'sections' ? <SectionsPanel /> : <PropertiesPanel />}
          </section>
        </main>
      )}
    </div>
  );
}

function MobileTabButton(props: {
  active: boolean;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider ${
        props.active
          ? 'bg-surface-2 text-neutral-100'
          : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
      }`}
    >
      {props.label}
    </button>
  );
}

/** Collapse toggle header for the desktop side rails. When `collapsed` is
 *  true, only the toggle button shows (32 px strip); otherwise the header
 *  sits above the rail content. `side` controls which direction the glyph
 *  points. */
function RailHeader(props: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  expandLabel: string;
  collapseLabel: string;
  side: 'left' | 'right';
}): JSX.Element {
  const expandGlyph = props.side === 'left' ? '▶' : '◀';
  const collapseGlyph = props.side === 'left' ? '◀' : '▶';
  return (
    <button
      type="button"
      aria-expanded={!props.collapsed}
      onClick={props.onToggle}
      title={props.collapsed ? props.expandLabel : props.collapseLabel}
      className={`flex h-8 w-full shrink-0 items-center justify-between border-b border-white/10 bg-surface-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 hover:bg-surface-2 hover:text-neutral-200 ${
        props.collapsed ? 'overflow-hidden' : ''
      }`}
    >
      {!props.collapsed && <span>{props.label}</span>}
      <span aria-hidden="true" className={props.collapsed ? 'mx-auto' : ''}>
        {props.collapsed ? expandGlyph : collapseGlyph}
      </span>
    </button>
  );
}

function GraphHeader(props: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  expandLabel: string;
  collapseLabel: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={!props.collapsed}
      onClick={props.onToggle}
      title={props.collapsed ? props.expandLabel : props.collapseLabel}
      className="flex h-8 w-full shrink-0 items-center justify-between border-b border-white/10 bg-surface-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 hover:bg-surface-2 hover:text-neutral-200"
    >
      <span>{props.label}</span>
      <span aria-hidden="true">{props.collapsed ? '▲' : '▼'}</span>
    </button>
  );
}

function SegmentedGroup(props: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="pointer-events-auto flex overflow-hidden rounded ring-1 ring-white/10 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(20, 20, 20, 0.6)' }}
    >
      {props.children}
    </div>
  );
}

function ButtonSvg({ svg }: { svg: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function Segment(props: {
  active: boolean;
  onClick: () => void;
  svg?: string;
  icon?: string;
  title: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      aria-label={props.title}
      title={props.title}
      onClick={props.onClick}
      className={`pointer-events-auto flex h-6 w-7 items-center justify-center text-[13px] leading-none ${
        props.active
          ? 'bg-sky-400/25 text-sky-100'
          : 'text-neutral-300 hover:bg-white/10 hover:text-neutral-100'
      }`}
    >
      {props.svg ? <ButtonSvg svg={props.svg} /> : props.icon}
    </button>
  );
}

function IconAction(props: {
  onClick: () => void;
  svg?: string;
  icon?: string;
  title: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={props.title}
      title={props.title}
      onClick={props.onClick}
      className="pointer-events-auto flex h-6 w-7 items-center justify-center rounded text-[13px] leading-none text-neutral-300 ring-1 ring-white/10 backdrop-blur-sm hover:bg-white/10 hover:text-neutral-100"
      style={{ backgroundColor: 'rgba(20, 20, 20, 0.6)' }}
    >
      {props.svg ? <ButtonSvg svg={props.svg} /> : props.icon}
    </button>
  );
}

function IconToggle(props: {
  active: boolean;
  onClick: () => void;
  svg?: string;
  icon?: string;
  title: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      aria-label={props.title}
      title={props.title}
      onClick={props.onClick}
      className={`pointer-events-auto flex h-6 w-7 items-center justify-center rounded text-[13px] leading-none ring-1 backdrop-blur-sm ${
        props.active
          ? 'bg-rose-400/25 text-rose-100 ring-rose-400/40'
          : 'text-neutral-300 ring-white/10 hover:bg-white/10 hover:text-neutral-100'
      }`}
      style={{
        backgroundColor: props.active ? undefined : 'rgba(20, 20, 20, 0.6)',
      }}
    >
      {props.svg ? <ButtonSvg svg={props.svg} /> : props.icon}
    </button>
  );
}

// Icon library — inline SVG bodies so we don't pull an icon dependency.
// viewBox is 0..20 on both axes with a 14×14 render box; stroke is 1.6.
const ORBIT_SVG = `<circle cx="10" cy="10" r="3" fill="currentColor" stroke="none"/><ellipse cx="10" cy="10" rx="7" ry="3" transform="rotate(-30 10 10)"/><ellipse cx="10" cy="10" rx="7" ry="3" transform="rotate(30 10 10)"/>`;
const POV_SVG = `<path d="M1 10 C 4 5 16 5 19 10 C 16 15 4 15 1 10 Z"/><circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none"/>`;
const TUBULAR_SVG = `<rect x="3" y="7" width="14" height="6" rx="3"/><line x1="3" y1="10" x2="17" y2="10"/>`;
const RIBBON_SVG = `<line x1="3" y1="10" x2="17" y2="10"/>`;
const PERSP_SVG = `<polygon points="4,4 16,4 13,16 7,16"/>`;
const ORTHO_SVG = `<rect x="4" y="4" width="12" height="12"/>`;
const HEART_SVG = `<path d="M10 16 C 3 11 3 5 7 5 C 9 5 10 7 10 7 C 10 7 11 5 13 5 C 17 5 17 11 10 16 Z" fill="currentColor" stroke="none"/>`;
const FIT_SVG = `<polyline points="3,7 3,3 7,3"/><polyline points="17,7 17,3 13,3"/><polyline points="3,13 3,17 7,17"/><polyline points="17,13 17,17 13,17"/>`;
