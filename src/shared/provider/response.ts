import { t } from '../i18n';
import { ProviderTimeoutError } from '../provider-error';

function timeoutError(): Error {
  return new ProviderTimeoutError();
}
function invalidJson(): Error {
  return new Error(t('接口没有返回有效的 JSON。', 'The provider returned invalid JSON.'));
}
export async function readProviderJson(response: Response, signal: AbortSignal): Promise<unknown> {
  return parseModelPayload(await readBody(response, signal));
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
