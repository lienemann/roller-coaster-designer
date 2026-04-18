// SPDX-License-Identifier: AGPL-3.0-only
import i18next, { type i18n as I18nInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import commonDe from './locales/de/common.json';
import editorDe from './locales/de/editor.json';
import errorsDe from './locales/de/errors.json';
import exportDe from './locales/de/export.json';
import functionsDe from './locales/de/functions.json';
import sectionsDe from './locales/de/sections.json';
import commonEn from './locales/en/common.json';
import editorEn from './locales/en/editor.json';
import errorsEn from './locales/en/errors.json';
import exportEn from './locales/en/export.json';
import functionsEn from './locales/en/functions.json';
import sectionsEn from './locales/en/sections.json';

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const I18N_NAMESPACES = [
  'common',
  'editor',
  'sections',
  'functions',
  'export',
  'errors',
] as const;

/**
 * Initializes i18next with bundled JSON resources. No network fetch — all
 * strings ship with the app bundle, which keeps the offline PWA promise.
 */
export function initI18n(): Promise<I18nInstance> {
  return i18next
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: {
          common: commonEn,
          editor: editorEn,
          sections: sectionsEn,
          functions: functionsEn,
          export: exportEn,
          errors: errorsEn,
        },
        de: {
          common: commonDe,
          editor: editorDe,
          sections: sectionsDe,
          functions: functionsDe,
          export: exportDe,
          errors: errorsDe,
        },
      },
      fallbackLng: 'en',
      supportedLngs: [...SUPPORTED_LANGUAGES],
      ns: [...I18N_NAMESPACES],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
        lookupLocalStorage: 'rcd-language',
      },
      returnNull: false,
    })
    .then(() => i18next);
}
