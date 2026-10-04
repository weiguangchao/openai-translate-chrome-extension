export const TOKEN_USAGE_KEY = 'subline.tokens.v1';

export interface TokenUsage {
  input: number;
  output: number;
  cache: number;
}

function positiveCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), Number.MAX_SAFE_INTEGER);
}

function addCounts(left: number, right: number): number {
  return Math.min(left + right, Number.MAX_SAFE_INTEGER);
}

function definedCount(values: unknown[]): number {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    return positiveCount(value);
  }
  return 0;
}

function usageDetails(usage: Record<string, unknown>): Record<string, unknown> {
  const details = usage.prompt_tokens_details ?? usage.input_tokens_details;
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
}

export function normalizeTokenUsage(value: unknown): TokenUsage {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    input: positiveCount(record.input),
    output: positiveCount(record.output),
    cache: positiveCount(record.cache),
  };
}

export function readProviderUsage(payload: unknown): TokenUsage | null {
  const usage =
    payload && typeof payload === 'object' ? (payload as { usage?: unknown }).usage : undefined;
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;
  const details = usageDetails(record);
  const tokens = normalizeTokenUsage({
    input: definedCount([record.prompt_tokens, record.input_tokens]),
    output: definedCount([record.completion_tokens, record.output_tokens]),
    cache: addCounts(
      definedCount([
        details.cached_tokens,
        record.cached_tokens,
        record.prompt_cache_hit_tokens,
        record.cache_read_input_tokens,
        details.cache_read_input_tokens,
      ]),
      definedCount([
        details.cache_write_tokens,
        record.cache_creation_input_tokens,
        record.cache_write_tokens,
      ]),
    ),
  });
  return tokens.input || tokens.output || tokens.cache ? tokens : null;
}

export function tokenTotal(usage: TokenUsage): number {
  return addCounts(usage.input, usage.output);
}

export function formatTokenCount(value: number): string {
  const rounded = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
    .format(rounded)
    .replace(/[\s\u202f]/g, '');
}

export function formatExactTokens(value: number): string {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0)).toLocaleString('en-US');
}

function extensionStorage(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) && Boolean(chrome.storage?.local)
    );
  } catch {
    return false;
  }
}

function pageStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

async function readStored(): Promise<TokenUsage> {
  try {
    if (extensionStorage()) {
      const stored = await chrome.storage.local.get(TOKEN_USAGE_KEY);
      return normalizeTokenUsage(stored[TOKEN_USAGE_KEY]);
    }
    const storage = pageStorage();
    if (!storage) return { input: 0, output: 0, cache: 0 };
    return normalizeTokenUsage(JSON.parse(storage.getItem(TOKEN_USAGE_KEY) ?? 'null'));
  } catch {
    return { input: 0, output: 0, cache: 0 };
  }
}

async function writeStored(usage: TokenUsage): Promise<void> {
  if (extensionStorage()) {
    await chrome.storage.local.set({ [TOKEN_USAGE_KEY]: usage });
    return;
  }
  pageStorage()?.setItem(TOKEN_USAGE_KEY, JSON.stringify(usage));
}

let pending = Promise.resolve();

export function addTokenUsage(delta: TokenUsage): Promise<void> {
  const amount = normalizeTokenUsage(delta);
  if (!amount.input && !amount.output && !amount.cache) return Promise.resolve();
  const run = pending.then(async () => {
    const current = await readStored();
    await writeStored({
      input: addCounts(current.input, amount.input),
      output: addCounts(current.output, amount.output),
      cache: addCounts(current.cache, amount.cache),
    });
  });
  pending = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch(() => undefined);
}

export function loadTokenUsage(): Promise<TokenUsage> {
  return readStored();
}

export function watchTokenUsage(onChange: (usage: TokenUsage) => void): () => void {
  if (!extensionStorage()) return () => undefined;
  const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== 'local' || !changes[TOKEN_USAGE_KEY]) return;
    onChange(normalizeTokenUsage(changes[TOKEN_USAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
