import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import { loadSettings, saveSettings } from '../src/shared/storage';
import { TOKEN_USAGE_KEY } from '../src/shared/token-usage';
import { Popup } from '../src/ui/Popup';

vi.mock('../src/shared/storage', () => ({
  isExtension: true,
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

let root: Root;
let stored: Settings;
const openOptionsPage = vi.fn();
const getManifest = () => ({ version: '0.1.1' });
const pageValues = new Map<string, string>();

beforeEach(() => {
  pageValues.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => pageValues.get(key) ?? null,
    setItem: (key: string, value: string) => pageValues.set(key, value),
    removeItem: (key: string) => pageValues.delete(key),
  });
  stored = { ...structuredClone(DEFAULT_SETTINGS), apiKey: 'test-key', model: 'provider/model-id' };
  vi.mocked(loadSettings)
    .mockReset()
    .mockImplementation(async () => structuredClone(stored));
  vi.mocked(saveSettings)
    .mockReset()
    .mockImplementation(async (value) => {
      stored = structuredClone(value);
    });
  openOptionsPage.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { runtime: { openOptionsPage, getManifest } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function render() {
  await act(async () => root.render(<Popup />));
}

function select(kind: 'source' | 'target') {
  return document.querySelector<HTMLSelectElement>(`#popup-${kind}-language`)!;
}

async function choose(kind: 'source' | 'target', value: string) {
  await act(async () => {
    select(kind).value = value;
    select(kind).dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(selector: string) {
  await act(async () => document.querySelector<HTMLButtonElement>(selector)!.click());
}

it('saves each language immediately and retains the latest provider and style settings', async () => {
  await render();
  stored.model = 'provider/new-model';
  stored.apiKey = 'new-key';
  stored.translation.size = 32;
  await choose('target', 'en');
  expect(stored).toMatchObject({
    targetLanguage: 'en',
    model: 'provider/new-model',
    apiKey: 'new-key',
    translation: { size: 32 },
  });
  expect(select('target').value).toBe('en');
  expect(document.querySelector('.popup-model-id')?.textContent).toBe('provider/new-model');
});

it.each([
  { providerConsent: '', hint: 'Allow subtitles to be sent to your provider in settings.' },
  { providerConsent: 'https://api.openai.com', hint: undefined },
])('asks for consent when the configured Provider has none: $providerConsent', async (row) => {
  stored.providerConsent = row.providerConsent;
  await render();
  expect(document.querySelector('.popup-setup-hint')?.textContent).toBe(row.hint);
});

it('offers one translation-language control with all four supported languages', async () => {
  await render();
  expect(document.querySelectorAll('select')).toHaveLength(1);
  expect([...select('target').options].map((option) => [option.value, option.text])).toEqual([
    ['en', 'English'],
    ['zh-CN', 'Simplified Chinese'],
    ['zh-TW', 'Traditional Chinese'],
    ['ja', 'Japanese'],
  ]);
});

it('toggles the extension without requiring a configured provider and keeps languages editable', async () => {
  stored.apiKey = '';
  stored.model = '';
  await render();
  await click('[role="switch"]');
  expect(stored.enabled).toBe(false);
  expect(document.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  expect(select('target').matches(':disabled')).toBe(false);
  await click('[role="switch"]');
  expect(stored.enabled).toBe(true);
});

it('saves translation-only from an unchecked default without touching other settings', async () => {
  await render();
  const checkbox = () =>
    document.querySelector<HTMLInputElement>('.popup-translation-only input[type="checkbox"]')!;
  expect(checkbox().checked).toBe(false);
  await click('.popup-translation-only input[type="checkbox"]');
  expect(stored).toMatchObject({ translationOnly: true, enabled: true, targetLanguage: 'zh-CN' });
  expect(checkbox().checked).toBe(true);
});

it('locks quick controls until a save finishes', async () => {
  await render();
  let finish!: () => void;
  vi.mocked(saveSettings).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await click('[role="switch"]');
  expect(select('target').matches(':disabled')).toBe(true);
  expect(document.querySelector('[role="switch"]')?.matches(':disabled')).toBe(true);
  await act(async () => finish());
  expect(select('target').matches(':disabled')).toBe(false);
  expect(document.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
});

it('restores the saved language after a write failure and clears the error after retrying', async () => {
  await render();
  vi.mocked(saveSettings).mockRejectedValueOnce(new Error('Storage unavailable'));
  await choose('target', 'ja');
  expect(stored.targetLanguage).toBe('zh-CN');
  expect(select('target').value).toBe('zh-CN');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Could not save. Try again.');
  expect(select('target').matches(':disabled')).toBe(false);
  await choose('target', 'ja');
  expect(stored.targetLanguage).toBe('ja');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('shows cumulative input, output, and cache tokens with compact units', async () => {
  localStorage.setItem(
    TOKEN_USAGE_KEY,
    JSON.stringify({ input: 1_500_000, output: 250_000, cache: 800_000 }),
  );
  await render();
  expect(document.querySelector('.popup-usage-total')?.textContent).toBe('1.8M');
  expect(document.querySelector('.popup-usage-total')?.getAttribute('title')).toBe('1,750,000');
  expect(document.querySelector('.popup-usage-input')?.textContent).toBe('1.5M');
  expect(document.querySelector('.popup-usage-output')?.textContent).toBe('250K');
  expect(document.querySelector('.popup-usage-cache')?.textContent).toBe('800K');
  expect(document.querySelector('.popup-usage-cache')?.getAttribute('title')).toBe('800,000');
});

it('updates the popup total when recorded tokens change', async () => {
  let listener!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
  const removeListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension-id', openOptionsPage, getManifest },
    storage: {
      local: {
        get: vi.fn(async (key: string) =>
          key === TOKEN_USAGE_KEY ? { [key]: { input: 1000, output: 0, cache: 200 } } : {},
        ),
      },
      onChanged: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        },
        removeListener,
      },
    },
  });
  await render();
  expect(document.querySelector('.popup-usage-total')?.textContent).toBe('1K');
  expect(document.querySelector('.popup-usage-cache')?.textContent).toBe('200');
  await act(async () => {
    listener(
      { [TOKEN_USAGE_KEY]: { newValue: { input: 2_500_000, output: 500_000, cache: 1_000_000 } } },
      'local',
    );
  });
  expect(document.querySelector('.popup-usage-total')?.textContent).toBe('3M');
  expect(document.querySelector('.popup-usage-input')?.textContent).toBe('2.5M');
  expect(document.querySelector('.popup-usage-output')?.textContent).toBe('500K');
  expect(document.querySelector('.popup-usage-cache')?.textContent).toBe('1M');
});

it('keeps controls disabled after a load failure and leaves settings accessible', async () => {
  vi.mocked(loadSettings).mockRejectedValueOnce(new Error('Storage unavailable'));
  await render();
  expect(select('target').matches(':disabled')).toBe(true);
  expect(document.querySelector('[role="switch"]')?.matches(':disabled')).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    'Could not load settings. Reopen the extension.',
  );
  await click('.popup-settings');
  expect(openOptionsPage).toHaveBeenCalledOnce();
  expect(saveSettings).not.toHaveBeenCalled();
});
