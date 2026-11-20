import type { Me } from '@openchat/api-client';
import { useEffect } from 'react';
import { api, preference, session } from './app-context';
import { getLocale, LANGUAGE_PREFERENCE, t } from './i18n';
import { LANGUAGES, type Locale } from './i18n/locales';

/**
 * Choosing a language keeps it in this browser, and reloads, so that everything on the page changes at once. Signed
 * in, the server keeps it too: it is the language translation is into, and a new device starts in it (ADR-0024).
 */
export function LanguagePicker({ className = '' }: { className?: string }) {
  return (
    <select
      className={`field w-auto ${className}`}
      aria-label={t('language')}
      value={getLocale()}
      onChange={async (event) => {
        const language = event.target.value as Locale;
        preference.set(LANGUAGE_PREFERENCE, language);
        if (session.isSignedIn()) await api.updateMe({ language }).catch(() => undefined);
        window.location.reload();
      }}
    >
      {LANGUAGES.map(([code, name]) => (
        <option key={code} value={code} lang={code}>
          {name}
        </option>
      ))}
    </select>
  );
}

/**
 * Once signed in: a browser that was never given a language takes the one kept on the server. Otherwise the server
 * is told the language shown here, so that it is never without one; the device used last wins.
 */
export function useServerLanguage(me: Me | undefined) {
  useEffect(() => {
    if (!me) return;
    const shown = getLocale();
    if (me.language && preference.get(LANGUAGE_PREFERENCE) === null) {
      preference.set(LANGUAGE_PREFERENCE, me.language);
      if (me.language !== shown) window.location.reload();
      return;
    }
    if (me.language !== shown) void api.updateMe({ language: shown }).catch(() => undefined);
  }, [me]);
}
