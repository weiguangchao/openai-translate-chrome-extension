import { readStoredTranslation } from '../shared/caption-translation';
import type { Settings } from '../shared/settings';

export const translationCacheLimit = 5000;

const PREFIX = 'subline.translation.v3:';
const PREVIEW = 'subline.translation.preview:';
const PREVIEW_KEYS = 'subline.translation.preview.keys';
const ORDER = 'subline.translation.order:';

function readKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];
}

interface SavedTranslation {
  key: string;
  translation: string;
  provider: Settings['provider'];
  temporary: boolean;
}

export class TranslationStore {
  private writes: Promise<void> = Promise.resolve();
  private pending: { entries: SavedTranslation[]; done: Promise<void> } | undefined;

  constructor(private limit = translationCacheLimit) {}

  async get(
    entries: readonly { key: string; primary?: string }[],
    includePreview = true,
  ): Promise<(string | null)[]> {
    try {
      for (;;) {
        const writes = this.writes;
        await writes;
        const stored: Record<string, unknown> = await chrome.storage.session.get(
          entries.flatMap(({ key, primary }) =>
            primary ? [PREFIX + primary, PREFIX + key, PREVIEW + key] : [PREFIX + key],
          ),
        );
        if (writes !== this.writes) continue;
        return entries.map(
          ({ key, primary }) =>
            (primary ? readStoredTranslation(stored[PREFIX + primary]) : null) ??
            readStoredTranslation(stored[PREFIX + key]) ??
            (primary && includePreview ? readStoredTranslation(stored[PREVIEW + key]) : null),
        );
      }
    } catch {
      return entries.map(() => null);
    }
  }

  save(entry: SavedTranslation): Promise<void> {
    if (!this.pending) {
      const entries = [entry];
      const done = this.write(async () => {
        if (this.pending?.entries === entries) this.pending = undefined;
        await this.saveBatch(entries);
      }).then(() => {});
      this.pending = { entries, done };
    } else this.pending.entries.push(entry);
    return this.pending.done;
  }

  retainPreview(live: ReadonlySet<string>): Promise<boolean> {
    this.pending = undefined;
    return this.write(async () => {
      const stored: Record<string, unknown> = await chrome.storage.session.get(PREVIEW_KEYS);
      const keys = readKeys(stored[PREVIEW_KEYS]);
      const gone = keys.filter((key) => !live.has(key));
      if (!gone.length) return;
      await chrome.storage.session.remove(gone.map((key) => PREVIEW + key));
      await chrome.storage.session.set({ [PREVIEW_KEYS]: keys.filter((key) => live.has(key)) });
    });
  }

  private async saveBatch(entries: readonly SavedTranslation[]): Promise<void> {
    const orderKeys = [
      ...new Set(entries.map((entry) => (entry.temporary ? PREVIEW_KEYS : ORDER + entry.provider))),
    ];
    const stored: Record<string, unknown> = await chrome.storage.session.get(orderKeys);
    const previous: Record<string, unknown> = orderKeys.some(
      (key) => key !== PREVIEW_KEYS && !Array.isArray(stored[key]),
    )
      ? await chrome.storage.session.get(null)
      : {};
    const orders = new Map(
      orderKeys.map((key) => [
        key,
        Array.isArray(stored[key]) || key === PREVIEW_KEYS
          ? readKeys(stored[key])
          : Object.keys(previous)
              .filter((item) => item.startsWith(`${PREFIX}["${key.slice(ORDER.length)}",`))
              .map((item) => item.slice(PREFIX.length)),
      ]),
    );
    const values: Record<string, unknown> = {};
    for (const entry of entries) {
      const orderKey = entry.temporary ? PREVIEW_KEYS : ORDER + entry.provider;
      orders.set(orderKey, [
        ...orders.get(orderKey)!.filter((key) => key !== entry.key),
        entry.key,
      ]);
      values[(entry.temporary ? PREVIEW : PREFIX) + entry.key] = entry.translation;
    }
    const gone: string[] = [];
    for (const [key, order] of orders) {
      if (key !== PREVIEW_KEYS) {
        const evicted = order.splice(0, Math.max(0, order.length - this.limit));
        for (const item of evicted) {
          gone.push(PREFIX + item);
          delete values[PREFIX + item];
        }
      }
      values[key] = order;
    }
    if (gone.length) await chrome.storage.session.remove(gone);
    await chrome.storage.session.set(values);
  }

  private write(work: () => Promise<void>): Promise<boolean> {
    const result = this.writes.then(work).then(
      () => true,
      () => false,
    );
    this.writes = result.then(() => {});
    return result;
  }
}
