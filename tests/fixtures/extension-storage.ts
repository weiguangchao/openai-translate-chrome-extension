import { IDBFactory } from 'fake-indexeddb';
import { locks } from 'node:worker_threads';
import { vi } from 'vitest';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

export function sessionStorage(stored = new Map<string, unknown>()) {
  return {
    stored,
    get: vi.fn(async (keys: string | string[] | null) => {
      const selected =
        keys === null ? [...stored.keys()] : typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(
        selected
          .filter((key) => stored.has(key))
          .map((key) => [key, structuredClone(stored.get(key))]),
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) stored.set(key, structuredClone(value));
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const key of keys) stored.delete(key);
    }),
  };
}

export function extensionStorage(stored = new Map<string, unknown>()) {
  const listeners: Listener[] = [];
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', { language: navigator.language, locks });
  return {
    stored,
    local: {
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async (key: string) =>
        stored.has(key) ? { [key]: structuredClone(stored.get(key)) } : {},
      ),
      set: vi.fn(async (items: Record<string, unknown>) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: stored.get(key), newValue: structuredClone(value) };
          stored.set(key, structuredClone(value));
        }
        for (const listener of listeners) listener(changes, 'local');
      }),
    },
    onChanged: {
      addListener: vi.fn((listener: Listener) => {
        listeners.push(listener);
      }),
    },
  };
}
