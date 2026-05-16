// SPDX-License-Identifier: AGPL-3.0-only

import { WebFvdError, lintFvdCompatibility } from '@roller-coaster-designer/core';
import { type TFunction } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  exportFvd,
  exportNl2Csv,
  hasFileSystemAccess,
  importFvd,
  openProject,
  saveProject,
  saveProjectAs,
} from '../io/file-system.js';
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
  const setFloorTileMeters = useAppStore((s) => s.setFloorTileMeters);
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

  const handleImportFvd = useCallback(async () => {
    try {
      const result = await importFvd();
      if (!result) return;
      loadProject({ project: result.project, name: result.name, handle: null });
      if (result.warnings.length > 0) {
        alert(`${result.name} loaded as ${result.version}.\n\n${result.warnings.join('\n')}`);
      }
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

  const handleExportFvd = useCallback(async () => {
    if (!project) return;
    // FVD++ compatibility check. If anything would be lost or reinterpreted
    // on export, surface a confirm before writing — the user can either go
    // ahead (the export then drops/transforms the flagged fields) or
    // cancel and adjust the project first.
    const notes = lintFvdCompatibility(project);
    if (notes.length > 0) {
      const lines = notes.map((n) => `• ${n.message}`).join('\n');
      const proceed = window.confirm(`${t('common:menu.exportFvdWarning')}\n\n${lines}`);
      if (!proceed) return;
    }
    try {
      await exportFvd(project);
    } catch (err) {
      alert(translateError(err, t));
    }
  }, [project, t]);

  const handleExportNl2 = useCallback(async () => {
    if (!project) return;
    try {
      await exportNl2Csv(project);
    } catch (err) {
      alert(translateError(err, t));
    }
  }, [project, t]);

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
        <MenuButton onClick={handleImportFvd}>{t('common:menu.importFvd')}</MenuButton>
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
        <MenuButton onClick={handleExportFvd} disabled={project === null}>
          {t('common:menu.exportFvd')}
        </MenuButton>
        <MenuButton onClick={handleExportNl2} disabled={project === null}>
          {t('common:menu.exportNl2')}
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
          { label: t('common:menu.importFvd'), onClick: handleImportFvd },
          {
            label: t('common:menu.save'),
            onClick: handleSave,
            disabled: !canSave,
            title: canSave ? undefined : t('common:menu.saveUnavailable'),
          },
          { label: t('common:menu.saveAs'), onClick: handleSaveAs, disabled: project === null },
          {
            label: t('common:menu.exportFvd'),
            onClick: handleExportFvd,
            disabled: project === null,
          },
          {
            label: t('common:menu.exportNl2'),
            onClick: handleExportNl2,
            disabled: project === null,
          },
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
          floorTileMeters={environment.floorTileMeters}
          onSetSky={setSkyImage}
          onSetFloor={setFloorImage}
          onSetFloorColor={setFloorColor}
          onSetFloorVisible={setFloorVisible}
          onSetFloorTileMeters={setFloorTileMeters}
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
  floorTileMeters: number;
  onSetSky: (dataUri: string | null) => void;
  onSetFloor: (dataUri: string | null) => void;
  onSetFloorColor: (hex: string) => void;
  onSetFloorVisible: (visible: boolean) => void;
  onSetFloorTileMeters: (meters: number) => void;
  onClose: () => void;
  t: TFunction<['common', 'errors']>;
}

function SceneDialog({
  skyDataUri,
  floorDataUri,
  floorColor,
  floorVisible,
  floorTileMeters,
  onSetSky,
  onSetFloor,
  onSetFloorColor,
  onSetFloorVisible,
  onSetFloorTileMeters,
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
          <FloorTileMetersRow
            floorTileMeters={floorTileMeters}
            disabled={!floorVisible || !floorDataUri}
            onChange={onSetFloorTileMeters}
            label={t('common:scene.floorTile')}
            hint={t('common:scene.floorTileHint')}
          />
        </section>

        <p className="mt-1 text-xs text-neutral-500">{t('common:scene.note')}</p>
      </div>
    </div>
  );
}

interface FloorTileMetersRowProps {
  floorTileMeters: number;
  disabled: boolean;
  onChange: (meters: number) => void;
  label: string;
  hint: string;
}

/**
 * Slider + numeric input for the floor texture's tile size in metres.
 * The slider track covers a sensible 0.5 – 50 m range; typing into the
 * number field accepts anything positive (no maxima clamp). They stay in
 * sync via the store — dragging the slider updates the number, and a
 * typed value beyond the slider's range just parks the thumb at its end.
 */
function FloorTileMetersRow({
  floorTileMeters,
  disabled,
  onChange,
  label,
  hint,
}: FloorTileMetersRowProps): JSX.Element {
  const SLIDER_MIN = 0.5;
  const SLIDER_MAX = 50;
  const [buffer, setBuffer] = useState<string>(() => formatFloorTile(floorTileMeters));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (focused) return;
    setBuffer(formatFloorTile(floorTileMeters));
  }, [floorTileMeters, focused]);
  const commit = (raw: string): void => {
    const parsed = Number(raw.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) onChange(parsed);
    setBuffer(formatFloorTile(Number.isFinite(parsed) && parsed > 0 ? parsed : floorTileMeters));
  };
  return (
    <div
      className={`flex flex-col gap-1 text-xs text-neutral-400 ${disabled ? 'opacity-40' : ''}`}
      title={hint}
    >
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0">{label}</span>
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={0.1}
          value={Math.min(Math.max(floorTileMeters, SLIDER_MIN), SLIDER_MAX)}
          disabled={disabled}
          onChange={(ev) => onChange(Number(ev.target.value))}
          className="flex-1 accent-sky-400"
        />
        <input
          type="number"
          min={0}
          step={0.1}
          value={buffer}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={(ev) => {
            setFocused(false);
            commit(ev.target.value);
          }}
          onChange={(ev) => setBuffer(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
          }}
          className="w-20 rounded bg-surface-2 px-1.5 py-0.5 text-right tabular-nums text-neutral-200 focus:outline-none focus:ring-1 focus:ring-sky-400"
        />
        <span className="w-6 shrink-0">m</span>
      </div>
    </div>
  );
}

function formatFloorTile(m: number): string {
  return m >= 10 ? m.toFixed(1) : m.toFixed(2);
}

function translateError(err: unknown, t: TFunction<['common', 'errors']>): string {
  if (err instanceof WebFvdError) {
    return t(`errors:${err.code}`, err.context);
  }
  return t('errors:unknown');
}
