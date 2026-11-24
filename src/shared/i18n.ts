export const UI_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number]['value'];

export function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.some((language) => language.value === value);
}

export function browserUiLanguage(): UiLanguage {
  try {
    const locale = new Intl.Locale(navigator.language).maximize();
    if (locale.language === 'zh') return locale.script === 'Hant' ? 'zh-TW' : 'zh-CN';
    if (locale.language === 'ja') return 'ja';
  } catch {}
  return 'en';
}

let current = browserUiLanguage();

export function uiLanguage(): UiLanguage {
  return current;
}

export function setUiLanguage(language: UiLanguage): void {
  current = language;
}

export function t(zhCN: string, en: string, zhTW: string, ja: string): string {
  return { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja }[current];
}
