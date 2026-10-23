import { t } from './i18n';

export const LANGUAGES = [
  { value: 'en', label: t('英语', 'English'), native: 'English', english: 'English' },
  {
    value: 'zh-CN',
    label: t('简体中文', 'Simplified Chinese'),
    native: '简体中文',
    english: 'Simplified Chinese',
  },
  {
    value: 'zh-TW',
    label: t('繁体中文', 'Traditional Chinese'),
    native: '繁體中文',
    english: 'Traditional Chinese',
  },
  { value: 'ja', label: t('日语', 'Japanese'), native: '日本語', english: 'Japanese' },
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
