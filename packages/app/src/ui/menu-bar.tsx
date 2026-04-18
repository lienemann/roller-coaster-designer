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
  const environment = useAppStore((s) => s.environment);
  const setSkyImage = useAppStore((s) => s.setSkyImage);
  const setFloorImage = useAppStore((s) => s.setFloorImage);
  const setFloorColor = useAppStore((s) => s.setFloorColor);
  const setFloorVisible = useAppStore((s) => s.setFloorVisible);
  const [sceneOpen, setSceneOpen] = useState(false);

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

  const fsaSupported = hasFileSystemAccess();
  const canSave = project !== null && (fsaSupported ? handle !== null : false);

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
        <MenuButton onClick={() => setSceneOpen(true)}>{t('common:menu.scene')}</MenuButton>
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
          { label: t('common:menu.scene'), onClick: () => setSceneOpen(true) },
          {
            label: t('common:menu.preferences'),
            onClick: () => alert(t('common:menu.prefsStub')),
          },
        ]}
      />
      {sceneOpen && (
        <SceneDialog
          skyDataUri={environment.skyDataUri}
          floorDataUri={environment.floorDataUri}
          floorColor={environment.floorColor}
          floorVisible={environment.floorVisible}
          onSetSky={setSkyImage}
          onSetFloor={setFloorImage}
          onSetFloorColor={setFloorColor}
          onSetFloorVisible={setFloorVisible}
          onClose={() => setSceneOpen(false)}
          t={t}
        />
      )}
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

interface SceneDialogProps {
  skyDataUri: string | null;
  floorDataUri: string | null;
  floorColor: string;
  floorVisible: boolean;
  onSetSky: (dataUri: string | null) => void;
  onSetFloor: (dataUri: string | null) => void;
  onSetFloorColor: (hex: string) => void;
  onSetFloorVisible: (visible: boolean) => void;
  onClose: () => void;
  t: TFunction<['common', 'errors']>;
}

function SceneDialog({
  skyDataUri,
  floorDataUri,
  floorColor,
  floorVisible,
  onSetSky,
  onSetFloor,
  onSetFloorColor,
  onSetFloorVisible,
  onClose,
  t,
}: SceneDialogProps): JSX.Element {
  const readAsDataUri = async (file: File): Promise<string> =>
    await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  const handleSky = async (file: File | null): Promise<void> => {
    if (!file) return;
    onSetSky(await readAsDataUri(file));
  };
  const handleFloor = async (file: File | null): Promise<void> => {
    if (!file) return;
    onSetFloor(await readAsDataUri(file));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('common:scene.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex w-[min(92vw,420px)] flex-col gap-3 rounded-lg bg-surface-1 p-4 text-sm text-neutral-100 shadow-xl ring-1 ring-white/10"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('common:scene.title')}</h2>
          <button
            type="button"
            aria-label={t('common:scene.close')}
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
          >
            ×
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide text-neutral-400">
            {t('common:scene.sky')}
          </h3>
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center rounded bg-surface-2 px-2 py-1 text-xs hover:bg-white/10">
              {t('common:scene.import')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(ev) => void handleSky(ev.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              disabled={!skyDataUri}
              onClick={() => onSetSky(null)}
              className="rounded bg-surface-2 px-2 py-1 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('common:scene.clear')}
            </button>
            <span className="text-xs text-neutral-500">
              {skyDataUri ? t('common:scene.loaded') : t('common:scene.none')}
            </span>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide text-neutral-400">
            {t('common:scene.floor')}
          </h3>
          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={floorVisible}
              onChange={(ev) => onSetFloorVisible(ev.target.checked)}
              className="accent-sky-400"
            />
            {t('common:scene.floorVisible')}
          </label>
          <div className={`flex items-center gap-2 ${floorVisible ? '' : 'opacity-40'}`}>
            <label className="inline-flex cursor-pointer items-center rounded bg-surface-2 px-2 py-1 text-xs hover:bg-white/10">
              {t('common:scene.import')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(ev) => void handleFloor(ev.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              disabled={!floorDataUri}
              onClick={() => onSetFloor(null)}
              className="rounded bg-surface-2 px-2 py-1 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('common:scene.clear')}
            </button>
            <span className="text-xs text-neutral-500">
              {floorDataUri ? t('common:scene.loaded') : t('common:scene.colorUsed')}
            </span>
          </div>
          <label
            className={`flex items-center gap-2 text-xs text-neutral-400 ${
              floorVisible ? '' : 'opacity-40'
            }`}
          >
            {t('common:scene.floorColor')}
            <input
              type="color"
              value={floorColor}
              onChange={(ev) => onSetFloorColor(ev.target.value)}
              className="h-6 w-8 cursor-pointer rounded border border-white/10 bg-transparent p-0"
              disabled={Boolean(floorDataUri) || !floorVisible}
              title={
                floorDataUri ? t('common:scene.colorHiddenByImage') : t('common:scene.floorColor')
              }
            />
            <span className="tabular-nums text-neutral-300">{floorColor}</span>
          </label>
        </section>

        <p className="mt-1 text-xs text-neutral-500">{t('common:scene.note')}</p>
      </div>
    </div>
  );
}

function translateError(err: unknown, t: TFunction<['common', 'errors']>): string {
  if (err instanceof WebFvdError) {
    return t(`errors:${err.code}`, err.context);
  }
  return t('errors:unknown');
}
