// SPDX-License-Identifier: GPL-3.0-only

import { useTranslation } from 'react-i18next';

import { useAppStore } from './state/store.js';
import { LanguageSwitcher } from './ui/language-switcher.js';
import { MenuBar } from './ui/menu-bar.js';

export function App(): JSX.Element {
  const { t } = useTranslation('common');
  const project = useAppStore((s) => s.project);
  const projectName = useAppStore((s) => s.projectName);
  const isDirty = useAppStore((s) => s.isDirty);

  const documentLabel =
    project === null
      ? t('app.noProject')
      : `${projectName ?? t('app.untitled')}${isDirty ? ' *' : ''}`;

  return (
    <div className="flex h-full w-full flex-col bg-surface-0 text-neutral-100">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-surface-1 px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{t('app.title')}</h1>
          <span className="hidden text-xs text-neutral-400 sm:inline">v0.0.0 · pre-release</span>
        </div>
        <MenuBar />
        <div className="flex items-center gap-4">
          <span
            aria-label={t('app.currentProject')}
            className="max-w-[20ch] truncate text-xs text-neutral-400"
          >
            {documentLabel}
          </span>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_3fr_1fr] grid-rows-[1fr_auto]">
        <aside
          aria-label="sections-placeholder"
          className="row-span-2 overflow-auto border-r border-white/10 bg-surface-1 p-3 text-xs text-neutral-400"
        >
          Sections
        </aside>
        <section
          aria-label="viewport-placeholder"
          className="flex items-center justify-center border-b border-white/10 bg-surface-0 p-6 text-neutral-400"
        >
          <div className="max-w-md text-center">
            <p className="text-sm">{t('app.tagline')}</p>
            <p className="mt-2 text-xs text-neutral-500">{t('status.scaffold')}</p>
          </div>
        </section>
        <aside
          aria-label="properties-placeholder"
          className="row-span-2 overflow-auto border-l border-white/10 bg-surface-1 p-3 text-xs text-neutral-400"
        >
          Properties
        </aside>
        <footer
          aria-label="timeline-placeholder"
          className="bg-surface-2 p-3 text-xs text-neutral-500"
        >
          Timeline
        </footer>
      </main>
    </div>
  );
}
