import { t } from '../i18n';
import { readProviderJson } from './response';
import { ProviderHttpError, ProviderTimeoutError } from '../provider-error';
import { providerFetch, type ProviderSendPolicy } from './transport';
import {
  validateBaseUrl,
  validateSettings,
  type Settings,
  type CaptionTranslationSettings,
} from '../settings';
import { englishLanguageName } from '../languages';
import { addTokenUsage, readProviderUsage } from '../token-usage';
import { readStoredTranslation } from '../caption-translation';

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
function translatorInstructions(settings: Settings, pageTitle: string): string {
  const target = englishLanguageName(settings.targetLanguage);
  return `You are a professional native ${target} translator. Accurately and fluently translate each source item into ${target}, preserving meaning, tone, paragraphs, line breaks, and formatting; for each item provide only the translation, with no explanations, preambles, or notes. If the content contains HTML tags, place them correctly according to the translated word order and keep the tags intact; fully preserve placeholders and code; keep proper nouns and other content untranslated only when they do not need translation. Complete the translation using the following title, summary, and terminology context:

## Context Awareness
Document Metadata:
Title: “${pageTitle}”

`;
}

async function complete(
  settings: Settings,
  instructions: string,
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
        {
          role: 'system',
          content: instructions,
        },
        {
          role: 'user',
          content: `Translate to ${englishLanguageName(settings.targetLanguage)}:\n\n${input}`,
        },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature: 0,
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
  return complete(settings, translatorInstructions(settings, ''), text, 65536, signal);
}

export async function translateCaptionBatch(
  settings: CaptionTranslationSettings,
  texts: readonly string[],
  signal?: AbortSignal,
  onTranslation?: (index: number, translation: string) => void,
  policy?: ProviderSendPolicy,
): Promise<string[] | null> {
  const input =
    texts.map((text, index) => `[[p${index}]]\n${text}`).join('\n') + '\n[[source_end]]';
  const response = await complete(
    settings,
    translatorInstructions(settings, settings.pageTitle) + multiItemProtocol,
    input,
    65536,
    signal,
    true,
    policy,
  );
  signal?.throwIfAborted();
  const translations = readCaptionTranslations(response, texts.length);
  if (!translations) return null;
  translations.forEach((translation, index) => onTranslation?.(index, translation));
  return translations;
}

const multiItemProtocol = `

## Multi-item processing protocol
The input contains source items. Each item starts with its exact request id on one title line, followed by that item's source text. The source list ends with exactly one [[source_end]] line. Process every item independently according to the active task instructions, using the other items only as context. Return every supplied id exactly once in any order and preserve each id title byte-for-byte. Processed text may span multiple lines.

When a native response schema is supplied, follow it exactly. Otherwise, return each id title followed by only its processed text.



Do not wrap the entire response or protocol envelope in a Markdown fence. Fenced code blocks that belong to an item's processed content may be preserved. Do not include explanations outside processed text.
`;

function readCaptionTranslations(reply: string, count: number): string[] | null {
  const response = reply.replace(/\r?\n\[\[source_end\]\]$/, '');
  const titles = [...response.matchAll(/^\[\[(p\d+|source_end)\]\]\r?$/gm)];
  if (titles.length !== count || response.slice(0, titles[0].index).trim()) return null;
  const items = new Map<string, string>();
  for (const [index, title] of titles.entries()) {
    const translation = readStoredTranslation(
      response.slice(title.index + title[0].length, titles[index + 1]?.index),
    );
    if (translation === null || items.has(title[1])) return null;
    items.set(title[1], translation);
  }
  const translations: string[] = [];
  for (let index = 0; index < count; index++) {
    const translation = items.get(`p${index}`);
    if (translation === undefined) return null;
    translations.push(translation);
  }
  return translations;
}

async function readModelText(response: Response, signal: AbortSignal): Promise<string> {
  const payload = await readProviderJson(response, signal);
  const text = choiceText(payload) ?? '';
  const usage = readProviderUsage(payload);
  if (usage) await addTokenUsage(usage);
  return text;
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
