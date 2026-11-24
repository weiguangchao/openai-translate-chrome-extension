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
      'API 沒有傳回有效的 JSON，請檢查 Base URL 是否為 API 位址。',
      'API から有効な JSON が返されませんでした。Base URL が API のアドレスか確認してください。',
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
  if (!settings.apiKey.trim())
    throw new Error(
      t(
        '请先填写 API Key。',
        'Enter an API Key first.',
        '請先填寫 API Key。',
        '先に API Key を入力してください。',
      ),
    );
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
        '無法連線至 API。請檢查 Base URL、網路和網站存取權限；瀏覽器預覽還需要 API 允許 CORS。',
        'API に接続できません。Base URL、ネットワーク、サイトへのアクセス権限を確認してください。ブラウザプレビューでは API が CORS に対応している必要もあります。',
      ),
    );
  }
  const { response } = result;
  if (!response.ok) {
    const errors: Record<number, string> = {
      401: t(
        'API Key 无效或已过期。',
        'The API Key is invalid or expired.',
        'API Key 無效或已過期。',
        'API Key が無効か、期限切れです。',
      ),
      403: t(
        '接口拒绝访问，请检查 API Key 权限。',
        'Access denied. Check your API Key permissions.',
        'API 拒絕存取，請檢查 API Key 權限。',
        'アクセスが拒否されました。API Key の権限を確認してください。',
      ),
      404: t(
        '接口地址或模型不存在，请检查配置。',
        'The API endpoint or model was not found. Check your settings.',
        'API 位址或模型不存在，請檢查設定。',
        'API のアドレスまたはモデルが見つかりません。設定を確認してください。',
      ),
      429: t(
        '请求过于频繁或额度不足，请稍后重试。',
        'Rate limit or quota exceeded. Try again later.',
        '請求過於頻繁或額度不足，請稍後重試。',
        'リクエストが多すぎるか、利用枠が不足しています。しばらくしてから再試行してください。',
      ),
      500: t(
        '接口调用异常',
        'Provider request failed',
        'API 呼叫異常',
        'API の呼び出しでエラーが発生しました',
      ),
    };
    throw new ProviderHttpError(
      errors[response.status] ??
        t(
          `接口返回 HTTP ${response.status}，请稍后重试。`,
          `The provider returned HTTP ${response.status}. Try again later.`,
          `API 傳回 HTTP ${response.status}，請稍後重試。`,
          `API が HTTP ${response.status} を返しました。しばらくしてから再試行してください。`,
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
        '不支援此模型清單格式，可手動填寫 Model ID。',
        'モデル一覧の形式に対応していません。Model ID を手動で入力してください。',
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
        'API 沒有傳回可用的模型，可手動填寫 Model ID。',
        '利用できるモデルが返されませんでした。Model ID を手動で入力してください。',
      ),
    );
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
function translatorInstructions(settings: Settings, pageTitle: string): string {
  const target = englishLanguageName(settings.targetLanguage);
  const context = pageTitle ? `\n\nThe text comes from a page titled: ${pageTitle}` : '';
  return `You are a professional native ${target} translator. Translate the text into ${target} accurately and fluently, keeping its meaning, tone, and line breaks. Return only the translation, with no explanations or notes. Return text that needs no translation unchanged.${context}`;
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
        '模型未傳回譯文，請確認該模型支援 /chat/completions。',
        'モデルが翻訳を返しませんでした。/chat/completions に対応しているか確認してください。',
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

The input is a list of captions. Each caption starts with an id line such as [[p0]], followed by its text, and the list ends with [[source_end]]. Translate each caption on its own, using the other captions only as context. Return every id line exactly as given, once each, followed by its translation. Do not output [[source_end]], a Markdown fence, or anything else.`;

function readCaptionTranslations(reply: string, count: number): string[] | null {
  const response = reply.replace(/\r?\n\[\[source_end\]\]$/, '');
  const titles = [...response.matchAll(/^\[\[(p\d+|source_end)\]\]\r?$/gm)];
  if (count === 1 && !titles.length) {
    const translation = readStoredTranslation(response);
    return translation === null ? null : [translation];
  }
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
