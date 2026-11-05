import { t } from './i18n';
import type { Settings, CaptionTranslationSettings, ProviderKind } from './settings';
import { translationBatchLimit } from './tuning';
import type { ProviderSendPolicy } from './provider/transport';
import * as openai from './provider/openai';
import * as microsoft from './provider/microsoft';

interface TranslationProvider {
  translate(settings: Settings, text: string, signal?: AbortSignal): Promise<string>;
  translateCaptionBatch(
    settings: CaptionTranslationSettings,
    texts: readonly string[],
    signal?: AbortSignal,
    onTranslation?: (index: number, translation: string) => void,
    policy?: ProviderSendPolicy,
  ): Promise<string[] | null>;
}

const providers = { openai, microsoft } satisfies Record<ProviderKind, TranslationProvider>;

export const fetchModels = openai.fetchModels;

function checkText(text: string): void {
  if (!text.trim() || text.length > 5000)
    throw new Error(t('字幕内容为空或过长。', 'Subtitle text is empty or too long.'));
}

export async function translate(
  settings: Settings,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  checkText(text);
  return providers[settings.provider].translate(settings, text, signal);
}

export const translateCaptionBatch: TranslationProvider['translateCaptionBatch'] = async (
  settings: CaptionTranslationSettings,
  texts,
  signal,
  onTranslation,
  policy,
) => {
  texts.forEach(checkText);
  if (!texts.length || texts.length > translationBatchLimit)
    throw new Error(t('单次翻译的字幕过多。', 'Too many subtitles in one translation request.'));
  return providers[settings.provider].translateCaptionBatch(
    settings,
    texts,
    signal,
    onTranslation,
    policy,
  );
};
