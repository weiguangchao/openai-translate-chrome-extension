import { t } from '../i18n';
import { readStoredTranslation } from '../caption-translation';
import { type Language } from '../languages';
import { ProviderHttpError, ProviderTimeoutError } from '../provider-error';
import { MICROSOFT_ORIGIN, type Settings, type CaptionTranslationSettings } from '../settings';
import { providerFetch, type ProviderSendPolicy } from './transport';
import { readProviderJson } from './response';

const languages = {
  en: 'en',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  ja: 'ja',
  ko: 'ko',
} satisfies Record<Language, string>;

function microsoftLanguage(language: string): string {
  switch (language) {
    case 'en':
    case 'zh-CN':
    case 'zh-TW':
    case 'ja':
    case 'ko':
      return languages[language];
    default:
      throw new Error(t('翻译语言不支持。', 'Unsupported translation language.'));
  }
}

export async function translateCaptionBatch(
  settings: CaptionTranslationSettings,
  texts: readonly string[],
  signal?: AbortSignal,
  onTranslation?: (index: number, translation: string) => void,
  policy?: ProviderSendPolicy,
): Promise<string[] | null> {
  const target = microsoftLanguage(settings.targetLanguage);
  const url = new URL('/translate/translatetext', MICROSOFT_ORIGIN);
  url.search = new URLSearchParams({
    from: microsoftLanguage(settings.captionLanguage),
    to: target,
    isEnterpriseClient: 'false',
  }).toString();
  try {
    const { response, signal: deadline } = await providerFetch(
      url.href,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(texts),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      },
      signal,
      policy,
    );
    if (!response.ok)
      throw new ProviderHttpError(t('接口调用异常', 'Provider request failed'), response.status);
    const payload = await readProviderJson(response, deadline);
    signal?.throwIfAborted();
    if (!Array.isArray(payload) || payload.length !== texts.length) return null;
    const translations: string[] = [];
    for (const item of payload) {
      if (!item || typeof item !== 'object' || !('translations' in item)) return null;
      const entries: unknown = item.translations;
      if (!Array.isArray(entries) || entries.length !== 1) return null;
      const entry: unknown = entries[0];
      if (!entry || typeof entry !== 'object' || !('text' in entry) || !('to' in entry))
        return null;
      if (entry.to !== target) return null;
      const translation = readStoredTranslation(entry.text);
      if (translation === null) return null;
      translations.push(translation);
    }
    translations.forEach((translation, index) => onTranslation?.(index, translation));
    return translations;
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      throw new ProviderTimeoutError();
    throw error;
  }
}

export async function translate(
  settings: Settings,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const translations = await translateCaptionBatch(
    { ...settings, captionLanguage: 'en' },
    [text],
    signal,
  );
  const translation = translations?.[0];
  if (translation === undefined)
    throw new Error(t('接口未返回有效译文。', 'The provider returned no valid translation.'));
  return translation;
}
