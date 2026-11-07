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

export class TranslationStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(private limit = translationCacheLimit) {}

  async get(entries: readonly { key: string; primary?: string }[]): Promise<(string | null)[]> {
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
            (primary ? readStoredTranslation(stored[PREVIEW + key]) : null),
        );
      }
    } catch {
      return entries.map(() => null);
    }
  }

  save({
    key,
    translation,
    provider,
    temporary,
  }: {
    key: string;
    translation: string;
    provider: Settings['provider'];
    temporary: boolean;
  }): Promise<void> {
    return this.write(async () => {
      if (temporary) {
        const stored: Record<string, unknown> = await chrome.storage.session.get(PREVIEW_KEYS);
        const keys = readKeys(stored[PREVIEW_KEYS]);
        await chrome.storage.session.set({
          [PREVIEW + key]: translation,
          [PREVIEW_KEYS]: [...keys.filter((item) => item !== key), key],
        });
        return;
      }
      const orderKey = ORDER + provider;
      const stored: Record<string, unknown> = await chrome.storage.session.get(orderKey);
      const order = readKeys(stored[orderKey]);
      if (!Array.isArray(stored[orderKey])) {
        const previous = await chrome.storage.session.get(null);
        order.push(
          ...Object.keys(previous)
            .filter((item) => item.startsWith(`${PREFIX}["${provider}",`))
            .map((item) => item.slice(PREFIX.length)),
        );
      }
      const keys = [...order.filter((item) => item !== key), key];
      const gone = keys.splice(0, Math.max(0, keys.length - this.limit));
      if (gone.length) await chrome.storage.session.remove(gone.map((item) => PREFIX + item));
      await chrome.storage.session.set({ [PREFIX + key]: translation, [orderKey]: keys });
    });
  }

  retainPreview(live: ReadonlySet<string>): Promise<void> {
    return this.write(async () => {
      const stored: Record<string, unknown> = await chrome.storage.session.get(PREVIEW_KEYS);
      const keys = readKeys(stored[PREVIEW_KEYS]);
      const gone = keys.filter((key) => !live.has(key));
      if (!gone.length) return;
      await chrome.storage.session.remove(gone.map((key) => PREVIEW + key));
      await chrome.storage.session.set({ [PREVIEW_KEYS]: keys.filter((key) => live.has(key)) });
    });
  }

  private write(work: () => Promise<void>): Promise<void> {
    this.writes = this.writes.then(work).catch(() => {});
    return this.writes;
  }
}
