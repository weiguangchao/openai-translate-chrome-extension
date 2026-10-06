export interface SubtitleStyle {
  color: string;
  size: number;
}
export interface Settings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  original: SubtitleStyle;
  translation: SubtitleStyle;
  backgroundOpacity: number;
  subtitleGap: number;
  youtube: boolean;
  hbo: boolean;
  x: boolean;
}
export type PublicSettings = Omit<Settings, 'apiKey' | 'baseUrl' | 'model'> & {
  configured: boolean;
  translationRevision: string;
};
export const LANGUAGES = [
  { value: 'en', label: '英语', native: 'English', english: 'English' },
  { value: 'zh-CN', label: '简体中文', native: '简体中文', english: 'Simplified Chinese' },
  { value: 'zh-TW', label: '繁体中文', native: '繁體中文', english: 'Traditional Chinese' },
  { value: 'ja', label: '日语', native: '日本語', english: 'Japanese' },
  { value: 'ko', label: '韩语', native: '한국어', english: 'Korean' },
  { value: 'fr', label: '法语', native: 'Français', english: 'French' },
  { value: 'de', label: '德语', native: 'Deutsch', english: 'German' },
  { value: 'es', label: '西班牙语', native: 'Español', english: 'Spanish' },
  { value: 'pt', label: '葡萄牙语', native: 'Português', english: 'Portuguese' },
  { value: 'it', label: '意大利语', native: 'Italiano', english: 'Italian' },
  { value: 'ru', label: '俄语', native: 'Русский', english: 'Russian' },
  { value: 'ar', label: '阿拉伯语', native: 'العربية', english: 'Arabic' },
  { value: 'hi', label: '印地语', native: 'हिन्दी', english: 'Hindi' },
  { value: 'th', label: '泰语', native: 'ไทย', english: 'Thai' },
  { value: 'vi', label: '越南语', native: 'Tiếng Việt', english: 'Vietnamese' },
];
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  original: { color: '#FFFFFF', size: 24 },
  translation: { color: '#B8E5CF', size: 20 },
  backgroundOpacity: 35,
  subtitleGap: 8,
  youtube: true,
  hbo: true,
  x: true,
};
export const STORAGE_KEY = 'subline.settings.v1';
export function normalizeSettings(value: unknown): Settings {
  const input = value && typeof value === 'object' ? (value as Partial<Settings>) : {};
  const result = structuredClone(DEFAULT_SETTINGS);
  for (const key of ['enabled', 'youtube', 'hbo', 'x'] as const)
    if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const key of ['baseUrl', 'apiKey', 'model'] as const)
    if (typeof input[key] === 'string') result[key] = input[key];
  for (const key of ['sourceLanguage', 'targetLanguage'] as const)
    if (LANGUAGES.some((l) => l.value === input[key])) result[key] = input[key]!;
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
  const { apiKey: _key, baseUrl: _url, model: _model, ...rest } = settings;
  return {
    ...rest,
    translationRevision,
    configured: Boolean(settings.apiKey.trim() && settings.model.trim()),
  };
}
export function validateBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('请输入完整的 Base URL，例如 https://api.openai.com/v1');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('Base URL 需要使用 HTTP 或 HTTPS。');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Base URL 不能包含用户名、密码、查询参数或锚点。');
  if (/\/(chat\/completions|completions|models?)\/?$/.test(url.pathname))
    throw new Error('请填写接口根地址，例如 /v1，不要包含 /chat/completions 或 /models。');
  return url;
}
export function validateSettings(settings: Settings, requireConnection = false): void {
  validateBaseUrl(settings.baseUrl);
  if (settings.sourceLanguage === settings.targetLanguage)
    throw new Error('学习语言和母语需要不同。');
  if (requireConnection && !settings.apiKey.trim()) throw new Error('请先填写 API Key。');
  if (requireConnection && !settings.model.trim()) throw new Error('请先选择或填写 Model ID。');
}
export function languageName(value: string): string {
  return LANGUAGES.find((l) => l.value === value)?.native ?? value;
}
export function englishLanguageName(value: string): string {
  return LANGUAGES.find((l) => l.value === value)?.english ?? value;
}

export interface SettingsChange {
  style: boolean;
  source: boolean;
  translation: boolean;
  availability: boolean;
}

export function classifySettingsChange(
  previous: Settings | PublicSettings,
  next: Settings | PublicSettings,
): SettingsChange {
  const changed = <Key extends keyof Settings & keyof PublicSettings>(key: Key) =>
    JSON.stringify(previous[key]) !== JSON.stringify(next[key]);
  const providerChanged =
    'apiKey' in previous && 'apiKey' in next
      ? (['baseUrl', 'apiKey', 'model'] as const).some((key) => previous[key] !== next[key])
      : 'translationRevision' in previous &&
        'translationRevision' in next &&
        previous.translationRevision !== next.translationRevision;
  return {
    style: (['original', 'translation', 'backgroundOpacity', 'subtitleGap'] as const).some(changed),
    source: changed('sourceLanguage'),
    translation: changed('targetLanguage') || providerChanged,
    availability:
      (['enabled', 'youtube', 'hbo', 'x'] as const).some(changed) ||
      ('configured' in previous && 'configured' in next && previous.configured !== next.configured),
  };
}
