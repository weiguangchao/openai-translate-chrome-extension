import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TOKEN_USAGE_KEY,
  addTokenUsage,
  formatExactTokens,
  formatTokenCount,
  loadTokenUsage,
  readProviderUsage,
  tokenTotal,
  watchTokenUsage,
  type TokenUsage,
} from '../src/shared/token-usage';

afterEach(() => {
  vi.unstubAllGlobals();
});

function memoryStorage() {
  const values: Record<string, unknown> = {};
  const listener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension-id' },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(values, items);
          listener(items);
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  return values;
}

describe('provider usage', () => {
  it('reads OpenAI prompt, completion, and cached token counts', () => {
    expect(
      readProviderUsage({
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 340,
          total_tokens: 1540,
          prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 50 },
        },
      }),
    ).toEqual({ input: 1200, output: 340, cache: 850 });
    expect(tokenTotal({ input: 1200, output: 340, cache: 850 })).toBe(1540);
  });

  it('accepts compatible input, output, and cache aliases without double counting', () => {
    expect(
      readProviderUsage({
        usage: {
          input_tokens: 90,
          output_tokens: 10,
          cache_read_input_tokens: 40,
          cache_creation_input_tokens: 15,
        },
      }),
    ).toEqual({ input: 90, output: 10, cache: 55 });
    expect(
      readProviderUsage({
        usage: {
          prompt_tokens: 30,
          completion_tokens: 4,
          cached_tokens: 12,
          prompt_cache_hit_tokens: 12,
        },
      }),
    ).toEqual({ input: 30, output: 4, cache: 12 });
    expect(
      readProviderUsage({
        usage: { prompt_tokens: 30, completion_tokens: 4, prompt_cache_hit_tokens: 12 },
      }),
    ).toEqual({ input: 30, output: 4, cache: 12 });
  });

  it.each([
    ['missing', {}],
    ['empty', { usage: { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 } }],
    ['non-numeric', { usage: { prompt_tokens: '12', completion_tokens: '3' } }],
    ['not an object', { usage: ['prompt_tokens'] }],
  ])('ignores %s usage', (_label, payload) => {
    expect(readProviderUsage(payload)).toBeNull();
  });
});

describe('compact token counts', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1K'],
    [1499, '1.5K'],
    [9949, '9.9K'],
    [9950, '10K'],
    [12_340, '12.3K'],
    [999_949, '999.9K'],
    [999_950, '1M'],
    [1_500_000, '1.5M'],
    [12_340_000, '12.3M'],
    [999_950_000, '1B'],
    [1_500_000_000, '1.5B'],
  ])('formats %i as %s', (value, text) => {
    expect(formatTokenCount(value)).toBe(text);
    expect(formatExactTokens(value)).toBe(value.toLocaleString('en-US'));
  });
});

describe('stored totals', () => {
  it('accumulates concurrent provider usage without dropping a write', async () => {
    const values = memoryStorage();
    await Promise.all([
      addTokenUsage({ input: 1, output: 2, cache: 3 }),
      addTokenUsage({ input: 10, output: 20, cache: 30 }),
      addTokenUsage({ input: 100, output: 200, cache: 300 }),
    ]);
    expect(values[TOKEN_USAGE_KEY]).toEqual({ input: 111, output: 222, cache: 333 });
    await expect(loadTokenUsage()).resolves.toEqual({ input: 111, output: 222, cache: 333 });
  });

  it('keeps the previous total when a later write fails', async () => {
    const values = memoryStorage();
    await addTokenUsage({ input: 4, output: 5, cache: 6 });
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('quota'));
    await expect(addTokenUsage({ input: 1, output: 1, cache: 1 })).resolves.toBeUndefined();
    expect(values[TOKEN_USAGE_KEY]).toEqual({ input: 4, output: 5, cache: 6 });
    await addTokenUsage({ input: 2, output: 0, cache: 0 });
    expect(values[TOKEN_USAGE_KEY]).toEqual({ input: 6, output: 5, cache: 6 });
  });

  it('stores usage in localStorage outside the extension', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    await addTokenUsage({ input: 1500, output: 20, cache: 0 });
    expect(JSON.parse(values.get(TOKEN_USAGE_KEY) ?? 'null')).toEqual({
      input: 1500,
      output: 20,
      cache: 0,
    });
    await expect(loadTokenUsage()).resolves.toEqual({ input: 1500, output: 20, cache: 0 });
  });

  it('notifies the popup only for local token changes', () => {
    const changes: TokenUsage[] = [];
    let listener!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    vi.stubGlobal('chrome', {
      runtime: { id: 'extension-id' },
      storage: {
        local: { get: vi.fn(), set: vi.fn() },
        onChanged: {
          addListener: (callback: typeof listener) => {
            listener = callback;
          },
          removeListener: vi.fn(),
        },
      },
    });
    const stop = watchTokenUsage((usage) => changes.push(usage));
    listener({ [TOKEN_USAGE_KEY]: { newValue: { input: 2000, output: 5, cache: 1 } } }, 'local');
    listener({ 'subline.settings.v1': { newValue: { enabled: false } } }, 'local');
    listener({ [TOKEN_USAGE_KEY]: { newValue: { input: 9 } } }, 'session');
    expect(changes).toEqual([{ input: 2000, output: 5, cache: 1 }]);
    stop();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledOnce();
  });
});
