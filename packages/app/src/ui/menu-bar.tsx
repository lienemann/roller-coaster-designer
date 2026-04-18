// SPDX-License-Identifier: AGPL-3.0-only

import { WebFvdError } from '@roller-coaster-designer/core';
import { type TFunction } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { hasFileSystemAccess, openProject, saveProject, saveProjectAs } from '../io/file-system.js';
import { useAppStore } from '../state/store.js';

export function MenuBar(): JSX.Element {
  const { t } = useTranslation(['common', 'errors']);
  const project = useAppStore((s) => s.project);
  const handle = useAppStore((s) => s.projectHandle);
  const newProject = useAppStore((s) => s.newProject);
  const loadProject = useAppStore((s) => s.loadProject);
  const loadDemoProject = useAppStore((s) => s.loadDemoProject);
  const markSaved = useAppStore((s) => s.markSaved);
  const closeCurrentTrack = useAppStore((s) => s.closeCurrentTrack);

  const handleNew = useCallback(() => {
    newProject();
  }, [newProject]);

  const handleLoadDemo = useCallback(() => {
    loadDemoProject();
  }, [loadDemoProject]);

  const handleOpen = useCallback(async () => {
    try {
      const result = await openProject();
      if (!result) return;
      loadProject({ project: result.project, name: result.name, handle: result.handle });
    } catch (err) {
      alert(translateError(err, t));
    }
  }, [loadProject, t]);

  const handleSave = useCallback(async () => {
    if (!project) return;
    try {
      const result = await saveProject(project, handle);
      if (!result) return;
      markSaved({ name: result.name, handle: result.handle });
    } catch (err) {
      alert(translateError(err, t));
    }
  }, [project, handle, markSaved, t]);

  const handleSaveAs = useCallback(async () => {
    if (!project) return;
    try {
      const result = await saveProjectAs(project);
      if (!result) return;
      markSaved({ name: result.name, handle: result.handle });
    } catch (err) {
      alert(translateError(err, t));
    }
  }, [project, markSaved, t]);

  const handleCloseTrack = useCallback(() => {
    try {
      closeCurrentTrack();
    } catch (err) {
      alert(translateError(err, t));
    }
  }, [closeCurrentTrack, t]);

  const fsaSupported = hasFileSystemAccess();
  const canSave = project !== null && (fsaSupported ? handle !== null : false);
  const canCloseTrack =
    project !== null && project.tracks.length > 0 && (project.tracks[0]?.sections.length ?? 0) >= 2;

  // Primary actions stay visible at all widths; secondary actions collapse
  // into an overflow menu on narrow screens. CSS-only hide/show matches the
  // spec §20b "compact menu" deferral without adding a resize observer.
  // At <640 px everything but "New" collapses so the bar never overflows.
  return (
    <nav aria-label={t('common:menu.file')} className="flex items-center gap-1 text-sm">
      <MenuButton onClick={handleNew}>{t('common:menu.new')}</MenuButton>

      {/* "Load Demo" keeps a direct button from small breakpoints up — it's
          the first thing a new visitor should see. */}
      <span className="hidden sm:contents">
        <MenuButton onClick={handleLoadDemo}>{t('common:menu.loadDemo')}</MenuButton>
      </span>

      <span className="hidden md:contents">
        <MenuButton onClick={handleOpen}>{t('common:menu.open')}</MenuButton>
        <MenuButton
          onClick={handleSave}
          disabled={!canSave}
          title={canSave ? undefined : t('common:menu.saveUnavailable')}
        >
          {t('common:menu.save')}
        </MenuButton>
        <MenuButton onClick={handleSaveAs} disabled={project === null}>
          {t('common:menu.saveAs')}
        </MenuButton>
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-white/10" />
        <MenuButton onClick={handleCloseTrack} disabled={!canCloseTrack}>
          {t('common:menu.closeTrack')}
        </MenuButton>
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-white/10" />
        <MenuButton onClick={() => alert(t('common:menu.prefsStub'))}>
          {t('common:menu.preferences')}
        </MenuButton>
      </span>

      <OverflowMenu
        label={t('common:menu.more')}
        items={[
          { label: t('common:menu.loadDemo'), onClick: handleLoadDemo },
          { label: t('common:menu.open'), onClick: handleOpen },
          {
            label: t('common:menu.save'),
            onClick: handleSave,
            disabled: !canSave,
            title: canSave ? undefined : t('common:menu.saveUnavailable'),
          },
          { label: t('common:menu.saveAs'), onClick: handleSaveAs, disabled: project === null },
          {
            label: t('common:menu.closeTrack'),
            onClick: handleCloseTrack,
            disabled: !canCloseTrack,
          },
          {
            label: t('common:menu.preferences'),
            onClick: () => alert(t('common:menu.prefsStub')),
          },
        ]}
      />
    </nav>
  );
}

interface MenuButtonProps {
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string | undefined;
}

function MenuButton({ onClick, children, disabled, title }: MenuButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="rounded px-2 py-1 text-neutral-200 ring-1 ring-transparent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => void onClick()}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

interface OverflowItem {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  title?: string | undefined;
}

function OverflowMenu(props: { label: string; items: OverflowItem[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click-away closes the menu.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (ev: MouseEvent): void => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative md:hidden" aria-label="overflow">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded px-2 py-1 text-neutral-200 ring-1 ring-transparent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-white/30"
      >
        {props.label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 flex min-w-[10rem] flex-col gap-0.5 rounded border border-white/10 bg-surface-1 p-1 text-sm shadow-lg"
        >
          {props.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                void item.onClick();
              }}
              className="rounded px-2 py-1 text-left text-neutral-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function translateError(err: unknown, t: TFunction<['common', 'errors']>): string {
  if (err instanceof WebFvdError) {
    return t(`errors:${err.code}`, err.context);
  }
  return t('errors:unknown');
}
