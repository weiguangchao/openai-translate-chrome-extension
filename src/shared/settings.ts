import { LANGUAGES, type Language } from './languages';

export interface SubtitleStyle {
  color: string;
  size: number;
}
export interface Settings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerConsent: string;
  targetLanguage: string;
  original: SubtitleStyle;
  translation: SubtitleStyle;
  backgroundOpacity: number;
  subtitleGap: number;
  translationOnly: boolean;
  youtube: boolean;
  hbo: boolean;
  x: boolean;
}
export type PublicSettings = Omit<Settings, 'apiKey' | 'baseUrl' | 'model' | 'providerConsent'> & {
  configured: boolean;
  translationRevision: string;
};
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  providerConsent: '',
  targetLanguage: 'zh-CN',
  original: { color: '#FFFFFF', size: 24 },
  translation: { color: '#B8E5CF', size: 20 },
  backgroundOpacity: 35,
  subtitleGap: 8,
  translationOnly: false,
  youtube: true,
  hbo: true,
  x: true,
};
export const STORAGE_KEY = 'subline.settings.v1';
export function normalizeSettings(value: unknown): Settings {
  const input = value && typeof value === 'object' ? (value as Partial<Settings>) : {};
  const result = structuredClone(DEFAULT_SETTINGS);
  for (const key of ['enabled', 'translationOnly', 'youtube', 'hbo', 'x'] as const)
    if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const key of ['baseUrl', 'apiKey', 'model', 'providerConsent'] as const)
    if (typeof input[key] === 'string') result[key] = input[key];
  if (LANGUAGES.some((language) => language.value === input.targetLanguage))
    result.targetLanguage = input.targetLanguage!;
  for (const key of ['original', 'translation'] as const) {
    if (/^#[\da-f]{6}$/i.test(input[key]?.color ?? '')) result[key].color = input[key]!.color;
    if (Number.isFinite(input[key]?.size))
      result[key].size = Math.min(48, Math.max(12, Math.round(input[key]!.size)));
  }
  if (Number.isFinite(input.backgroundOpacity))
    result.backgroundOpacity = Math.min(90, Math.max(0, input.backgroundOpacity!));
  if (Number.isFinite(input.subtitleGap))
    result.subtitleGap = Math.min(24, Math.max(0, input.subtitleGap!));
  return result;
}
export function publicSettings(settings: Settings, translationRevision = ''): PublicSettings {
  const {
    apiKey: _key,
    baseUrl: _url,
    model: _model,
    providerConsent: _consent,
    ...rest
  } = settings;
  return {
    ...rest,
    translationRevision,
    configured:
      Boolean(settings.apiKey.trim() && settings.model.trim()) && hasProviderConsent(settings),
  };
}
const localHttpHosts = ['localhost', '127.0.0.1'];
export function validateBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('请输入完整的 Base URL，例如 https://api.openai.com/v1');
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && localHttpHosts.includes(url.hostname))
  )
    throw new Error(
      'Base URL 需要使用 HTTPS。只有本机服务（localhost 或 127.0.0.1）可以使用 HTTP。',
    );
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Base URL 不能包含用户名、密码、查询参数或锚点。');
  if (/\/(chat\/completions|completions|models?)\/?$/.test(url.pathname))
    throw new Error('请填写接口根地址，例如 /v1，不要包含 /chat/completions 或 /models。');
  return url;
}
export function providerOrigin(baseUrl: string): string {
  try {
    return validateBaseUrl(baseUrl).origin;
  } catch {
    return '';
  }
}
export function hasProviderConsent(settings: Settings): boolean {
  const origin = providerOrigin(settings.baseUrl);
  return Boolean(origin) && settings.providerConsent === origin;
}
export function validateSettings(settings: Settings, requireConnection = false): void {
  validateBaseUrl(settings.baseUrl);
  if (requireConnection && !settings.apiKey.trim()) throw new Error('请先填写 API Key。');
  if (requireConnection && !settings.model.trim()) throw new Error('请先选择或填写 Model ID。');
}
type SettingScope = 'availability' | 'credentials' | 'translation' | 'style';

const SETTING_SCOPES: Record<keyof Settings, SettingScope> = {
  enabled: 'availability',
  baseUrl: 'translation',
  apiKey: 'credentials',
  model: 'translation',
  providerConsent: 'availability',
  targetLanguage: 'translation',
  original: 'style',
  translation: 'style',
  backgroundOpacity: 'style',
  subtitleGap: 'style',
  translationOnly: 'style',
  youtube: 'availability',
  hbo: 'availability',
  x: 'availability',
};

function settingsIn(...scopes: SettingScope[]): (keyof Settings)[] {
  return (Object.keys(SETTING_SCOPES) as (keyof Settings)[]).filter((key) =>
    scopes.includes(SETTING_SCOPES[key]),
  );
}

export type CaptionTranslationSettings = Settings & { captionLanguage: Language };

const identityKeys = [...settingsIn('translation'), 'captionLanguage'] as const;

export const translationIdentityLength = identityKeys.length;

export function translationIdentity(settings: CaptionTranslationSettings): unknown[] {
  return identityKeys.map((key) => settings[key]);
}

export interface SettingsChange {
  style: boolean;
  translation: boolean;
  availability: boolean;
}

export function classifySettingsChange(
  previous: Settings | PublicSettings,
  next: Settings | PublicSettings,
): SettingsChange {
  const changed = (key: string) =>
    key in previous &&
    key in next &&
    JSON.stringify(Reflect.get(previous, key)) !== JSON.stringify(Reflect.get(next, key));
  const changedIn = (...scopes: SettingScope[]) => settingsIn(...scopes).some(changed);
  return {
    style: changedIn('style'),
    translation: changedIn('translation', 'credentials') || changed('translationRevision'),
    availability: changedIn('availability') || changed('configured'),
  };
}
