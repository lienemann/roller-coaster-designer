// SPDX-License-Identifier: AGPL-3.0-only

import {
  isSectionKindAuthorable,
  lintFvdCompatibility,
  sectionHasFvdCompatIssue,
  type FvdCompatNote,
  type SectionDoc,
} from '@roller-coaster-designer/core';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '../state/store.js';

/**
 * Left-rail panel: the anchor (track-level pose) as a pinned first row,
 * then the sections of the first track. Clicking selects; the Properties
 * panel edits. Add buttons append docs with sensible defaults.
 */
export function SectionsPanel(): JSX.Element {
  const { t } = useTranslation(['common', 'sections']);
  const project = useAppStore((s) => s.project);
  const selected = useAppStore((s) => s.selectedSection);
  const selectSection = useAppStore((s) => s.selectSection);
  const addStraight = useAppStore((s) => s.addStraightSection);
  const addCurved = useAppStore((s) => s.addCurvedSection);
  const addLoop = useAppStore((s) => s.addLoopSection);
  const addGeometric = useAppStore((s) => s.addGeometricSection);
  const addForced = useAppStore((s) => s.addForcedSection);
  const addBezier = useAppStore((s) => s.addBezierSection);
  const removeSection = useAppStore((s) => s.removeSection);
  const closeCurrentTrack = useAppStore((s) => s.closeCurrentTrack);
  const insertAfterSelection = useAppStore((s) => s.insertAfterSelection);
  const setInsertAfterSelection = useAppStore((s) => s.setInsertAfterSelection);

  const sections = project?.tracks[0]?.sections ?? [];
  const hasClosure = sections.some((s) => s.kind === 'closure');
  const canAdd = project !== null;
  const compatNotes: FvdCompatNote[] = useMemo(
    () => (project ? lintFvdCompatibility(project) : []),
    [project],
  );
  const canClose = project !== null && sections.length >= 1 && !hasClosure;
  const fvdCompat = project?.fvdCompatibilityMode ?? true;

  const onCloseTrack = useCallback(() => {
    closeCurrentTrack();
  }, [closeCurrentTrack]);

  const onRemove = useCallback(
    (event: React.MouseEvent, idx: number) => {
      event.stopPropagation();
      removeSection(idx);
    },
    [removeSection],
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {t('common:panels.sections')}
      </header>

      <ol className="flex flex-col gap-1 text-xs">
        {project !== null && (
          <li
            onClick={() => selectSection('anchor')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectSection('anchor');
              }
            }}
            className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 ring-1 ${
              selected === 'anchor'
                ? 'bg-white/10 text-neutral-100 ring-white/40'
                : 'bg-surface-2 text-neutral-300 ring-white/10 hover:bg-white/5'
            }`}
          >
            <span className="truncate">
              <span className="mr-2 text-neutral-500">⚓</span>
              <span>{t('common:sections.anchor')}</span>
            </span>
          </li>
        )}
        {project !== null && sections.length === 0 && (
          <li className="text-neutral-500">{t('common:sections.empty')}</li>
        )}
        {sections.map((section, i) => {
          const isSelected = i === selected;
          const incompatible = sectionHasFvdCompatIssue(compatNotes, 0, i);
          const issueTitle = compatNotes
            .filter((n) => n.sectionIndex === i)
            .map((n) => n.message)
            .join('\n');
          return (
            <li
              key={i}
              onClick={() => selectSection(i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectSection(i);
                }
              }}
              className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 ring-1 ${
                isSelected
                  ? 'bg-white/10 text-neutral-100 ring-white/40'
                  : 'bg-surface-2 text-neutral-300 ring-white/10 hover:bg-white/5'
              }`}
            >
              <span className="truncate">
                <span className="mr-2 text-neutral-500">{i + 1}.</span>
                <span>{section.name || kindName(section, t)}</span>
                <span className="ml-2 text-neutral-500">{kindName(section, t)}</span>
                {incompatible && (
                  <span
                    className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle"
                    title={issueTitle}
                    aria-label={t('common:sections.fvdIncompatible')}
                  />
                )}
              </span>
              <button
                type="button"
                className="ml-2 rounded px-1 text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
                onClick={(e) => onRemove(e, i)}
                aria-label={t('common:sections.remove')}
                title={t('common:sections.remove')}
              >
                ×
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-3">
        <label className="flex items-center gap-2 px-1 text-[11px] text-neutral-400">
          <input
            type="checkbox"
            checked={insertAfterSelection}
            onChange={(e) => setInsertAfterSelection(e.target.checked)}
            className="h-3 w-3"
          />
          {t('common:sections.insertAfterSelection')}
        </label>
        <AddButton
          onClick={addStraight}
          disabled={!canAdd || !isSectionKindAuthorable('straight', fvdCompat)}
          label={t('common:sections.addStraight')}
        />
        <AddButton
          onClick={addCurved}
          disabled={!canAdd || !isSectionKindAuthorable('curved', fvdCompat)}
          label={t('common:sections.addCurved')}
        />
        <AddButton
          onClick={addLoop}
          disabled={!canAdd || !isSectionKindAuthorable('curved', fvdCompat)}
          label={t('common:sections.addLoop')}
        />
        <AddButton
          onClick={addGeometric}
          disabled={!canAdd || !isSectionKindAuthorable('geometric', fvdCompat)}
          label={t('common:sections.addGeometric')}
        />
        <AddButton
          onClick={addForced}
          disabled={!canAdd || !isSectionKindAuthorable('forced', fvdCompat)}
          label={t('common:sections.addForced')}
        />
        <AddButton
          onClick={addBezier}
          disabled={!canAdd || !isSectionKindAuthorable('bezier', fvdCompat)}
          label={t('common:sections.addBezier')}
        />
        <button
          type="button"
          onClick={onCloseTrack}
          disabled={!canClose}
          className="rounded border border-white/10 bg-surface-2 px-2 py-1 text-xs text-neutral-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↻ {t('common:menu.closeTrack')}
        </button>
      </div>
    </div>
  );
}

function AddButton(props: { onClick: () => void; disabled: boolean; label: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded border border-white/10 bg-surface-2 px-2 py-1 text-xs text-neutral-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      + {props.label}
    </button>
  );
}

function kindName(section: SectionDoc, t: (key: string) => string): string {
  return t(`sections:kind.${section.kind}`);
}
