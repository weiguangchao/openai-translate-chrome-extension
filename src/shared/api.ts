import { t } from './i18n';
import { ProviderHttpError, ProviderTimeoutError } from './provider-error';
import { providerFetch, type ProviderSendPolicy } from './provider/transport';
import { translationBatchLimit } from './tuning';
import {
  validateBaseUrl,
  validateSettings,
  type Settings,
  type CaptionTranslationSettings,
} from './settings';
import { englishLanguageName } from './languages';
import { addTokenUsage, readProviderUsage } from './token-usage';
import { readStoredTranslation } from './caption-translation';

function endpoint(settings: Settings, path: string): string {
  return validateBaseUrl(settings.baseUrl).href.replace(/\/+$/, '') + path;
}
function timeoutError(): Error {
  return new ProviderTimeoutError();
}
function invalidJson(): Error {
  return new Error(
    t(
      '接口没有返回有效的 JSON，请检查 Base URL 是否为 API 地址。',
      'The provider returned invalid JSON. Check that the Base URL points to an API.',
    ),
  );
}
async function fetchApi(
  settings: Settings,
  path: string,
  body: unknown,
  signal?: AbortSignal,
  policy?: ProviderSendPolicy,
): Promise<{ response: Response; signal: AbortSignal }> {
  if (!settings.apiKey.trim()) throw new Error(t('请先填写 API Key。', 'Enter an API Key first.'));
  let result: { response: Response; signal: AbortSignal };
  try {
    result = await providerFetch(
      endpoint(settings, path),
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${settings.apiKey.trim()}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      },
      signal,
      policy,
    );
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      throw timeoutError();
    throw new Error(
      t(
        '无法连接接口。请检查 Base URL、网络和网站访问权限；浏览器预览还需要接口允许 CORS。',
        'Could not connect to the provider. Check the Base URL, network, and site permissions. Browser previews also require CORS support.',
      ),
    );
  }
  const { response } = result;
  if (!response.ok) {
    const errors: Record<number, string> = {
      401: t('API Key 无效或已过期。', 'The API Key is invalid or expired.'),
      403: t(
        '接口拒绝访问，请检查 API Key 权限。',
        'Access denied. Check your API Key permissions.',
      ),
      404: t(
        '接口地址或模型不存在，请检查配置。',
        'The API endpoint or model was not found. Check your settings.',
      ),
      429: t(
        '请求过于频繁或额度不足，请稍后重试。',
        'Rate limit or quota exceeded. Try again later.',
      ),
      500: t('接口调用异常', 'Provider request failed'),
    };
    throw new ProviderHttpError(
      errors[response.status] ??
        t(
          `接口返回 HTTP ${response.status}，请稍后重试。`,
          `The provider returned HTTP ${response.status}. Try again later.`,
        ),
      response.status,
    );
  }
  return result;
}
async function request(
  settings: Settings,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const { response } = await fetchApi(settings, path, body, signal);
  try {
    return await response.json();
  } catch {
    throw invalidJson();
  }
}
export async function fetchModels(settings: Settings): Promise<string[]> {
  let response: unknown;
  try {
    response = await request(settings, '/models');
  } catch (error) {
    if (!(error instanceof ProviderHttpError) || ![404, 405].includes(error.status)) throw error;
    response = await request(settings, '/model');
  }
  const object = response as { data?: unknown; models?: unknown } | null;
  const items = Array.isArray(response) ? response : (object?.data ?? object?.models);
  if (!Array.isArray(items))
    throw new Error(
      t(
        '模型列表格式不受支持，可手动填写 Model ID。',
        'Unsupported model list format. Enter the Model ID manually.',
      ),
    );
  const ids = items
    .map((item) => (typeof item === 'string' ? item : item?.id))
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  if (!ids.length)
    throw new Error(
      t(
        '接口没有返回可用模型，可手动填写 Model ID。',
        'The provider returned no models. Enter the Model ID manually.',
      ),
    );
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
function translatorInstructions(settings: Settings): string {
  const target = englishLanguageName(settings.targetLanguage);
  return `You are a professional ${target} native translator. Translate each source item accurately and fluently into ${target}.

## Translation Requirements
- Treat each source item as a complete translation unit, including a single word, short phrase, heading, label, or site name. Do not ask for more context, a full article, or additional text.
- Return only the translated content for each item, following the required response format. Do not add explanations, apologies, greetings, or commentary. If an item should remain untranslated, return it unchanged.
- Preserve its meaning, tone, paragraph structure, and meaningful formatting.
- Keep code, placeholders, and content that must not be translated unchanged.
- Use supplied document context and terminology consistently.`;
}

function checkText(text: string): void {
  if (!text.trim() || text.length > 5000)
    throw new Error(t('字幕内容为空或过长。', 'Subtitle text is empty or too long.'));
}

async function complete(
  settings: Settings,
  input: string,
  maxTokens: number,
  signal: AbortSignal | undefined,
  caption = false,
  policy?: ProviderSendPolicy,
): Promise<string> {
  validateSettings(settings, true);
  const { response, signal: deadline } = await fetchApi(
    settings,
    '/chat/completions',
    {
      model: settings.model.trim(),
      messages: [
        { role: 'system', content: translatorInstructions(settings) },
        {
          role: 'user',
          content: `Translate to ${englishLanguageName(settings.targetLanguage)}:\n\n${input}`,
        },
      ],
      stream: false,
      max_tokens: maxTokens,
      reasoning_effort: 'low',
      thinking: { type: 'disabled' },
    },
    signal,
    policy,
  );
  const text = await readModelText(response, deadline);
  if (!caption && !text.trim())
    throw new Error(
      t(
        '模型未返回译文，请确认该模型支持 /chat/completions。',
        'The model returned no translation. Check that it supports /chat/completions.',
      ),
    );
  return text.trim();
}

export async function translate(
  settings: Settings,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  checkText(text);
  return complete(settings, text, 65536, signal);
}

export async function translateCaptionBatch(
  settings: CaptionTranslationSettings,
  texts: readonly string[],
  signal?: AbortSignal,
  onTranslation?: (index: number, translation: string) => void,
  policy?: ProviderSendPolicy,
): Promise<string[] | null> {
  texts.forEach(checkText);
  if (!texts.length || texts.length > translationBatchLimit)
    throw new Error(t('单次翻译的字幕过多。', 'Too many subtitles in one translation request.'));
  const response = await complete(settings, texts[0], 65536, signal, true, policy);
  signal?.throwIfAborted();
  const translation = readStoredTranslation(response);
  if (translation === null) return null;
  onTranslation?.(0, translation);
  return [translation];
}

async function readModelText(response: Response, signal: AbortSignal): Promise<string> {
  const payload = parseModelPayload(await readBody(response, signal));
  const text = choiceText(payload) ?? '';
  const usage = readProviderUsage(payload);
  if (usage) await addTokenUsage(usage);
  return text;
}

async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw timeoutError();
      const { done, value } = await reader.read();
      if (signal.aborted) throw timeoutError();
      if (value) pending += decoder.decode(value, { stream: !done });
      if (!done) continue;
      return pending + decoder.decode();
    }
  } catch (error) {
    if (signal.aborted) throw timeoutError();
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      throw timeoutError();
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function parseModelPayload(raw: string): unknown {
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  try {
    return JSON.parse(source);
  } catch {
    throw invalidJson();
  }
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const record = part as { type?: unknown; text?: unknown };
      if (record.type === 'reasoning' || record.type === 'thinking') return '';
      return typeof record.text === 'string' ? record.text : '';
    })
    .join('');
}

function choiceText(payload: unknown): string | null {
  const message = (
    payload as {
      choices?: {
        message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      }[];
    } | null
  )?.choices?.[0]?.message;
  return messageText(message?.content).trim() || null;
}
