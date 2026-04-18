// SPDX-License-Identifier: GPL-3.0-only

import { WebFvdError } from '@roller-coaster-designer/core';
import { type TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { hasFileSystemAccess, openProject, saveProject, saveProjectAs } from '../io/file-system.js';
import { useAppStore } from '../state/store.js';

export function MenuBar(): JSX.Element {
  const { t } = useTranslation(['common', 'errors']);
  const project = useAppStore((s) => s.project);
  const handle = useAppStore((s) => s.projectHandle);
  const newProject = useAppStore((s) => s.newProject);
  const loadProject = useAppStore((s) => s.loadProject);
  const markSaved = useAppStore((s) => s.markSaved);

  const handleNew = useCallback(() => {
    newProject();
  }, [newProject]);

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

  const fsaSupported = hasFileSystemAccess();
  const canSave = project !== null && (fsaSupported ? handle !== null : false);

  return (
    <nav aria-label={t('common:menu.file')} className="flex items-center gap-1 text-sm">
      <MenuButton onClick={handleNew}>{t('common:menu.new')}</MenuButton>
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

function translateError(err: unknown, t: TFunction<['common', 'errors']>): string {
  if (err instanceof WebFvdError) {
    return t(`errors:${err.code}`, err.context);
  }
  return t('errors:unknown');
}
