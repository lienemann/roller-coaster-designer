// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n/index.ts';

function isSupported(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function LanguageSwitcher(): JSX.Element {
  const { t, i18n } = useTranslation('common');

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value;
      if (isSupported(next)) {
        void i18n.changeLanguage(next);
      }
    },
    [i18n],
  );

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="rcd-lang" className="text-neutral-400">
        {t('lang.switch')}
      </label>
      <select
        id="rcd-lang"
        className="rounded bg-surface-2 px-2 py-1 text-neutral-100 outline-none ring-1 ring-white/10 focus:ring-white/30"
        value={i18n.resolvedLanguage ?? 'en'}
        onChange={handleChange}
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {t(`lang.${lng}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
