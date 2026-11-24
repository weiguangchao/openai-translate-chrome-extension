import { t } from './i18n';

export const LANGUAGES = [
  {
    value: 'en',
    get label() {
      return t('英语', 'English', '英文', '英語');
    },
    native: 'English',
    english: 'English',
  },
  {
    value: 'zh-CN',
    get label() {
      return t('简体中文', 'Simplified Chinese', '簡體中文', '簡体字中国語');
    },
    native: '简体中文',
    english: 'Simplified Chinese',
  },
  {
    value: 'zh-TW',
    get label() {
      return t('繁体中文', 'Traditional Chinese', '繁體中文', '繁体字中国語');
    },
    native: '繁體中文',
    english: 'Traditional Chinese',
  },
  {
    value: 'ja',
    get label() {
      return t('日语', 'Japanese', '日文', '日本語');
    },
    native: '日本語',
    english: 'Japanese',
  },
  {
    value: 'ko',
    get label() {
      return t('韩语', 'Korean', '韓文', '韓国語');
    },
    native: '한국어',
    english: 'Korean',
  },
] as const;

export type Language = (typeof LANGUAGES)[number]['value'];

export function supportedLanguage(value: string): Language | null {
  try {
    const locale = new Intl.Locale(value.replaceAll('_', '-')).maximize();
    if (locale.language === 'en' && locale.script === 'Latn') return 'en';
    if (locale.language === 'ja' && locale.script === 'Jpan') return 'ja';
    if (locale.language === 'ko' && locale.script === 'Kore') return 'ko';
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
