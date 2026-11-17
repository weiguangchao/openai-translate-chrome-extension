import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TranslationStore } from '../src/extension/translation-store';
import { sessionStorage } from './fixtures/extension-storage';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const flush = () => vi.advanceTimersByTimeAsync(0);
const prefix = 'subline.translation.v3:';
const preview = 'subline.translation.preview:';
const previewKeys = 'subline.translation.preview.keys';
const order = 'subline.translation.order:';
const entry = (
  key: string,
  translation = key,
  provider: 'microsoft' | 'openai' = 'microsoft',
  temporary = false,
) => ({ key, translation, provider, temporary });

it('writes eight arrived translations together and publishes them only after storage finishes', async () => {
  const session = sessionStorage(new Map([[order + 'microsoft', []]]));
  vi.stubGlobal('chrome', { storage: { session } });
  const write = session.set.getMockImplementation()!;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  session.set.mockImplementation(async (values) => {
    await gate;
    await write(values);
  });
  const store = new TranslationStore();
  let completed = 0;
  const saves = Array.from({ length: 8 }, (_, index) =>
    store.save(entry(String(index))).then(() => completed++),
  );
  let readCompleted = false;
  const read = store.get([{ key: '7' }]).then((values) => {
    readCompleted = true;
    return values;
  });
  await flush();
  expect(completed).toBe(0);
  expect(readCompleted).toBe(false);
  expect(session.get).toHaveBeenCalledTimes(1);
  expect(session.set).toHaveBeenCalledTimes(1);
  expect(Object.keys(session.set.mock.calls[0][0])).toHaveLength(9);
  finish();
  await Promise.all(saves);
  await expect(read).resolves.toEqual(['7']);
  expect(completed).toBe(8);
  await store.save(entry('single'));
  expect(session.set).toHaveBeenCalledTimes(2);
  await expect(new TranslationStore().get([{ key: 'single' }])).resolves.toEqual(['single']);
});

it('keeps the last value and each provider capacity without resurrecting evicted batch members', async () => {
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  const store = new TranslationStore(2);
  await Promise.all([
    store.save(entry('a')),
    store.save(entry('b')),
    store.save(entry('c')),
    store.save(entry('b', 'latest')),
    store.save(entry('o', 'openai', 'openai')),
  ]);
  await expect(store.get(['a', 'b', 'c', 'o'].map((key) => ({ key })))).resolves.toEqual([
    null,
    'latest',
    'c',
    'openai',
  ]);
  expect(session.stored.get(order + 'microsoft')).toEqual(['c', 'b']);
  expect(session.stored.get(order + 'openai')).toEqual(['o']);
  expect(session.stored.has(prefix + 'a')).toBe(false);
});

it('does not move a preview save across a window cleanup', async () => {
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  const store = new TranslationStore();
  await Promise.all([
    store.save(entry('old', 'old', 'microsoft', true)),
    store.retainPreview(new Set()),
    store.save(entry('new', 'new', 'microsoft', true)),
    store.save(entry('permanent')),
  ]);
  expect(session.stored.has(preview + 'old')).toBe(false);
  expect(session.stored.get(preview + 'new')).toBe('new');
  expect(session.stored.get(previewKeys)).toEqual(['new']);
  expect(session.stored.get(prefix + 'permanent')).toBe('permanent');
});

it('keeps saving and reading after a grouped write fails', async () => {
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  session.set.mockRejectedValueOnce(new Error('Session storage unavailable'));
  const store = new TranslationStore();
  await Promise.all([store.save(entry('a')), store.save(entry('b'))]);
  await store.save(entry('c'));
  await expect(store.get([{ key: 'c' }])).resolves.toEqual(['c']);
});
