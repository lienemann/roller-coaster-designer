// SPDX-License-Identifier: AGPL-3.0-only

import { SEC_TYPE_NAMES, type Section } from '@roller-coaster-designer/core';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '../state/store.js';

/**
 * Left-rail panel listing the sections of the first track. Clicking a row
 * selects it, which drives the Properties panel on the right rail. Add
 * buttons append a section with sensible defaults; the properties panel is
 * where users tune them.
 */
export function SectionsPanel(): JSX.Element {
  const { t } = useTranslation(['common', 'sections']);
  const project = useAppStore((s) => s.project);
  const selectedIndex = useAppStore((s) => s.selectedSectionIndex);
  const selectSection = useAppStore((s) => s.selectSection);
  const addStraight = useAppStore((s) => s.addStraightSection);
  const addCurved = useAppStore((s) => s.addCurvedSection);
  const addBezier = useAppStore((s) => s.addBezierSection);
  const removeSection = useAppStore((s) => s.removeSection);

  const sections = project?.tracks[0]?.sections ?? [];
  const canAdd = project !== null && sections.length > 0;

  const onRemove = useCallback(
    (event: React.MouseEvent, idx: number) => {
      event.stopPropagation();
      if (idx === 0) return;
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
        {sections.length === 0 && (
          <li className="text-neutral-500">{t('common:sections.empty')}</li>
        )}
        {sections.map((section, i) => {
          const isSelected = i === selectedIndex;
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
                <span>{section.name || sectionTypeName(section)}</span>
                <span className="ml-2 text-neutral-500">{sectionTypeName(section)}</span>
              </span>
              {i > 0 && (
                <button
                  type="button"
                  className="ml-2 rounded px-1 text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
                  onClick={(e) => onRemove(e, i)}
                  aria-label={t('common:sections.remove')}
                  title={t('common:sections.remove')}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-3">
        <AddButton
          onClick={addStraight}
          disabled={!canAdd}
          label={t('common:sections.addStraight')}
        />
        <AddButton onClick={addCurved} disabled={!canAdd} label={t('common:sections.addCurved')} />
        <AddButton onClick={addBezier} disabled={!canAdd} label={t('common:sections.addBezier')} />
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

function sectionTypeName(section: Section): string {
  return SEC_TYPE_NAMES[section.type];
}
