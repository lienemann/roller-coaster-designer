// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ForcesGraph } from './graphs/forces-graph.js';
import { PropertiesPanel } from './panels/properties-panel.js';
import { SectionsPanel } from './panels/sections-panel.js';
import { sectionColor } from './scene/section-colors.js';
import { Viewport } from './scene/viewport.js';
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

  useRecomputeOnProjectChange();

  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const [mobileTab, setMobileTab] = useState<MobileTab>('sections');

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
      <Viewport
        tracks={tracks}
        sectionColors={sectionColors}
        selectedSectionIndex={selectedSectionIndex}
      />
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
        <main className="grid min-h-0 flex-1 grid-cols-[1fr_3fr_1fr] grid-rows-[1fr_35%]">
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
            className="min-h-0 overflow-hidden bg-surface-2 p-2"
          >
            <ForcesGraph
              track={firstTrack}
              sectionStartTimes={sectionStartTimes}
              sectionColors={sectionColors}
              label={graphLabel}
            />
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
            className="min-h-0 flex-[2] overflow-hidden border-b border-white/10 bg-surface-2 p-2"
          >
            <ForcesGraph
              track={firstTrack}
              sectionStartTimes={sectionStartTimes}
              sectionColors={sectionColors}
              label={graphLabel}
            />
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
