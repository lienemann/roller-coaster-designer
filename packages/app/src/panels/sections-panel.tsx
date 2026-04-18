// SPDX-License-Identifier: AGPL-3.0-only

import { SEC_TYPE_NAMES, type Section } from '@roller-coaster-designer/core';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '../state/store.js';

/**
 * Left-rail panel listing the sections of the first track and offering
 * one-click "Add" buttons for Straight, Curved, and Bezier. Parameter
 * editing via a properties panel lands with M4; until then, Add uses
 * sensible defaults that pass schema validation and produce visible
 * geometry. Users with custom shapes in mind can still hand-edit the
 * saved .webfvd.json.
 */
export function SectionsPanel(): JSX.Element {
  const { t } = useTranslation(['common', 'sections']);
  const project = useAppStore((s) => s.project);
  const addStraight = useAppStore((s) => s.addStraightSection);
  const addCurved = useAppStore((s) => s.addCurvedSection);
  const addBezier = useAppStore((s) => s.addBezierSection);
  const removeSection = useAppStore((s) => s.removeSection);

  const sections = project?.tracks[0]?.sections ?? [];
  const canAdd = project !== null && sections.length > 0;

  const onRemove = useCallback(
    (idx: number) => {
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
        {sections.map((section, i) => (
          <li
            key={i}
            className="flex items-center justify-between rounded border border-white/10 bg-surface-2 px-2 py-1"
          >
            <span className="truncate">
              <span className="mr-2 text-neutral-500">{i + 1}.</span>
              <span className="text-neutral-200">{section.name || sectionTypeName(section)}</span>
              <span className="ml-2 text-neutral-500">{sectionTypeName(section)}</span>
            </span>
            {i > 0 && (
              <button
                type="button"
                className="ml-2 rounded px-1 text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
                onClick={() => onRemove(i)}
                aria-label={t('common:sections.remove')}
                title={t('common:sections.remove')}
              >
                ×
              </button>
            )}
          </li>
        ))}
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
