export const LANGUAGES = [
  { value: 'en', label: '英语', native: 'English', english: 'English' },
  { value: 'zh-CN', label: '简体中文', native: '简体中文', english: 'Simplified Chinese' },
  { value: 'zh-TW', label: '繁体中文', native: '繁體中文', english: 'Traditional Chinese' },
  { value: 'ja', label: '日语', native: '日本語', english: 'Japanese' },
] as const;

export type Language = (typeof LANGUAGES)[number]['value'];

export function supportedLanguage(value: string): Language | null {
  try {
    const locale = new Intl.Locale(value.replaceAll('_', '-')).maximize();
    if (locale.language === 'en' && locale.script === 'Latn') return 'en';
    if (locale.language === 'ja' && locale.script === 'Jpan') return 'ja';
    if (locale.language === 'zh') {
      if (locale.script === 'Hans') return 'zh-CN';
      if (locale.script === 'Hant') return 'zh-TW';
    }
  } catch {}
  return null;
}

export function englishLanguageName(value: string): string {
  return LANGUAGES.find((language) => language.value === value)?.english ?? value;
}
