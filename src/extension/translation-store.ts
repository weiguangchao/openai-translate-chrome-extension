import { readStoredTranslation } from '../shared/caption-translation';
import type { TranslationQueue, TranslationStore } from './queue';

const PREFIX = 'subline.translation.v2:';

function readEntry(key: string, value: unknown): [string, string] | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 5 || typeof parsed[4] !== 'string') return null;
    const translation = readStoredTranslation(value);
    return translation === null ? null : [key, translation];
  } catch {
    return null;
  }
}

function sessionStore(): TranslationStore {
  const saves = new Map<string, string>();
  const removals = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const items = Object.fromEntries([...saves].map(([key, value]) => [PREFIX + key, value]));
    const gone = [...removals].map((key) => PREFIX + key);
    saves.clear();
    removals.clear();
    if (gone.length) void chrome.storage.session.remove(gone).catch(() => {});
    if (Object.keys(items).length) void chrome.storage.session.set(items).catch(() => {});
  };
  const schedule = () => {
    timer ??= setTimeout(flush, 0);
  };
  return {
    save(key, translation) {
      removals.delete(key);
      saves.set(key, translation);
      schedule();
    },
    remove(key) {
      saves.delete(key);
      removals.add(key);
      schedule();
    },
  };
}

export async function restoreTranslations(queue: TranslationQueue): Promise<void> {
  let stored: Record<string, unknown> = {};
  try {
    stored = await chrome.storage.session.get(null);
  } catch {}
  const entries = Object.entries(stored).flatMap(([key, value]) => {
    const entry = key.startsWith(PREFIX) ? readEntry(key.slice(PREFIX.length), value) : null;
    return entry ? [entry] : [];
  });
  queue.restore(entries, sessionStore());
}
