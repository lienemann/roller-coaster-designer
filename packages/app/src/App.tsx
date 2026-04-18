// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ForcesGraph } from './graphs/forces-graph.js';
import { PropertiesPanel } from './panels/properties-panel.js';
import { SectionsPanel } from './panels/sections-panel.js';
import { sectionColor } from './scene/section-colors.js';
import { Viewport, type CameraMode } from './scene/viewport.js';
import { useAppStore } from './state/store.js';
import { LanguageSwitcher } from './ui/language-switcher.js';
import { MenuBar } from './ui/menu-bar.js';
import { useMediaQuery } from './ui/use-media-query.js';
import { useRecomputeOnProjectChange } from './worker/use-recompute.js';

type MobileTab = 'sections' | 'properties';

const DESKTOP_QUERY = '(min-width: 768px)';

export function App(): JSX.Element {
  const { t } = useTranslation('common');
  const project = useAppStore((s) => s.project);
  const projectName = useAppStore((s) => s.projectName);
  const isDirty = useAppStore((s) => s.isDirty);
  const tracks = useAppStore((s) => s.tracks);
  const selectedSectionIndex = useAppStore((s) => s.selectedSectionIndex);
  const selectSection = useAppStore((s) => s.selectSection);

  useRecomputeOnProjectChange();

  const fitViewEpoch = useAppStore((s) => s.fitViewEpoch);
  const resetViewEpoch = useAppStore((s) => s.resetViewEpoch);
  const requestFitView = useAppStore((s) => s.requestFitView);
  const requestResetView = useAppStore((s) => s.requestResetView);

  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const [mobileTab, setMobileTab] = useState<MobileTab>('sections');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [graphCollapsed, setGraphCollapsed] = useState(false);

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
  const sectionStartTimes = useMemo<number[]>(() => {
    const starts = firstTrack?.sectionStartNodes ?? [];
    const times = firstTrack?.cumulativeTime;
    if (!times) return [];
    return starts.map((nodeIndex) => times[nodeIndex] ?? 0);
  }, [firstTrack]);

  const graphLabel = {
    forceNormal: t('graphs.forceNormal'),
    forceLateral: t('graphs.forceLateral'),
    velocity: t('graphs.velocity'),
    time: t('graphs.time'),
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
          }}
          onSelectSection={selectSection}
        />
        <div
          role="toolbar"
          aria-label={t('viewport.cameraMode')}
          className="pointer-events-none absolute right-2 top-2 z-10 flex flex-wrap justify-end gap-1"
        >
          <CameraModeButton
            active={cameraMode === 'orbit'}
            onClick={() => setCameraMode('orbit')}
            label={t('viewport.orbit')}
          />
          <CameraModeButton
            active={cameraMode === 'pov'}
            onClick={() => setCameraMode('pov')}
            label={t('viewport.pov')}
          />
          <CameraModeButton active={false} onClick={requestFitView} label={t('viewport.fit')} />
          <CameraModeButton active={false} onClick={requestResetView} label={t('viewport.reset')} />
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
          className={`grid min-h-0 flex-1 grid-cols-[minmax(220px,1fr)_3fr_minmax(320px,1.4fr)] ${
            graphCollapsed ? 'grid-rows-[1fr_32px]' : 'grid-rows-[1fr_35%]'
          }`}
        >
          <aside
            aria-label={t('panels.sections')}
            className="row-span-2 overflow-auto border-r border-white/10 bg-surface-1 p-3"
          >
            <SectionsPanel />
          </aside>
          <section
            aria-label="viewport"
            className="relative min-h-0 border-b border-white/10 bg-surface-0"
          >
            {viewportContent}
          </section>
          <aside
            aria-label={t('panels.properties')}
            className="row-span-2 overflow-auto border-l border-white/10 bg-surface-1 p-3"
          >
            <PropertiesPanel />
          </aside>
          <footer
            aria-label={t('panels.graphs')}
            className="flex min-h-0 flex-col overflow-hidden bg-surface-2"
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

function CameraModeButton(props: {
  active: boolean;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`pointer-events-auto rounded px-2 py-1 text-xs font-semibold ring-1 ring-white/10 backdrop-blur-sm ${
        props.active
          ? 'bg-sky-400/20 text-sky-100 ring-sky-400/40'
          : 'bg-surface-1/80 text-neutral-300 hover:bg-surface-2'
      }`}
    >
      {props.label}
    </button>
  );
}
