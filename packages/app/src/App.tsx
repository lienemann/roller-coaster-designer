// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ForcesGraph } from './graphs/forces-graph.js';
import { PropertiesPanel } from './panels/properties-panel.js';
import { SectionsPanel } from './panels/sections-panel.js';
import { Viewport } from './scene/viewport.js';
import { useAppStore } from './state/store.js';
import { LanguageSwitcher } from './ui/language-switcher.js';
import { MenuBar } from './ui/menu-bar.js';
import { useRecomputeOnProjectChange } from './worker/use-recompute.js';

type MobileTab = 'sections' | 'properties';

export function App(): JSX.Element {
  const { t } = useTranslation('common');
  const project = useAppStore((s) => s.project);
  const projectName = useAppStore((s) => s.projectName);
  const isDirty = useAppStore((s) => s.isDirty);
  const tracks = useAppStore((s) => s.tracks);

  useRecomputeOnProjectChange();

  const [mobileTab, setMobileTab] = useState<MobileTab>('sections');

  const documentLabel =
    project === null
      ? t('app.noProject')
      : `${projectName ?? t('app.untitled')}${isDirty ? ' *' : ''}`;

  const firstTrack = tracks[0] ?? null;

  const graphPanel = (
    <div className="min-h-0 overflow-hidden bg-surface-2 p-2">
      <ForcesGraph
        track={firstTrack}
        label={{
          forceNormal: t('graphs.forceNormal'),
          forceLateral: t('graphs.forceLateral'),
          velocity: t('graphs.velocity'),
          time: t('graphs.time'),
          force: t('graphs.force'),
          velocityAxis: t('graphs.velocityAxis'),
        }}
      />
    </div>
  );

  const viewportPanel = (
    <section
      aria-label="viewport"
      className="relative min-h-0 border-b border-white/10 bg-surface-0"
    >
      {tracks.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="max-w-md text-center">
            <p className="text-sm text-neutral-400">{t('app.tagline')}</p>
            <p className="mt-2 text-xs text-neutral-500">{t('status.scaffold')}</p>
            <p className="mt-4 text-xs text-neutral-500">{t('app.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <Viewport tracks={tracks} />
      )}
    </section>
  );

  return (
    <div className="flex h-full w-full flex-col bg-surface-0 text-neutral-100">
      {/* Header. Wraps onto two lines below md. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 bg-surface-1 px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">
            {t('app.title')}
          </h1>
          <span className="hidden text-xs text-neutral-400 lg:inline">v0.0.0 · pre-release</span>
        </div>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <MenuBar />
          <span
            aria-label={t('app.currentProject')}
            className="order-last w-full truncate text-xs text-neutral-400 md:order-none md:w-auto md:max-w-[20ch]"
          >
            {documentLabel}
          </span>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Desktop: three-column grid with graphs docked under the viewport. */}
      <main className="hidden min-h-0 flex-1 grid-cols-[1fr_3fr_1fr] grid-rows-[1fr_35%] md:grid">
        <aside
          aria-label={t('panels.sections')}
          className="row-span-2 overflow-auto border-r border-white/10 bg-surface-1 p-3"
        >
          <SectionsPanel />
        </aside>
        {viewportPanel}
        <aside
          aria-label={t('panels.properties')}
          className="row-span-2 overflow-auto border-l border-white/10 bg-surface-1 p-3"
        >
          <PropertiesPanel />
        </aside>
        <footer aria-label={t('panels.graphs')}>{graphPanel}</footer>
      </main>

      {/* Narrow: stack vertically — viewport, graphs, then a tab strip that
          swaps Sections and Properties below. No drawers; tabs are always
          visible and take the same tap-targets the old floating buttons did. */}
      <main className="flex min-h-0 flex-1 flex-col md:hidden">
        <div className="min-h-0 flex-[3]">{viewportPanel}</div>
        <div className="min-h-0 flex-[2] border-t border-white/10">{graphPanel}</div>

        <div className="flex border-t border-white/10 bg-surface-1">
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
          className="min-h-0 flex-[2] overflow-auto border-t border-white/10 bg-surface-1 p-3"
        >
          {mobileTab === 'sections' ? <SectionsPanel /> : <PropertiesPanel />}
        </section>
      </main>
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
