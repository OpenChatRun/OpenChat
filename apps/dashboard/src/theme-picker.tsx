import { preference } from './app-context';
import { t } from './i18n';

export const THEME_PREFERENCE = 'openchat.theme';
const THEMES = [
  ['system', 'themeSystem'],
  ['light', 'themeLight'],
  ['dark', 'themeDark'],
] as const;
type Theme = (typeof THEMES)[number][0];

// The browser bar's colour, in each theme. index.html has the same pair for before this runs.
const BAR = { light: '#0e1a4f', dark: '#0a0a0b' } as const;

const stored = (): Theme => {
  const value = preference.get(THEME_PREFERENCE);
  return value === 'light' || value === 'dark' ? value : 'system';
};

/**
 * With no choice made the device decides, through the media query in styles.css. A choice is a data-theme
 * attribute on the root, which the dark variant there reads ahead of the device's setting.
 */
export function applyTheme(theme: Theme = stored()): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const own = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = BAR[theme === 'system' ? own : theme];
  });
}

export function ThemePicker({ className = '' }: { className?: string }) {
  return (
    <select
      className={`field w-auto ${className}`}
      aria-label={t('theme')}
      defaultValue={stored()}
      onChange={(event) => {
        const theme = event.target.value as Theme;
        preference.set(THEME_PREFERENCE, theme);
        applyTheme(theme);
      }}
    >
      {THEMES.map(([value, label]) => (
        <option key={value} value={value}>
          {t(label)}
        </option>
      ))}
    </select>
  );
}
