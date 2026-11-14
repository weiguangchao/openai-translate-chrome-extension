import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, applySettingsPatch, type Settings } from '../src/shared/settings';
import { loadSettings, saveSettings } from '../src/shared/storage';
import { TOKEN_USAGE_KEY } from '../src/shared/token-usage';
import { Popup } from '../src/ui/Popup';
import { createChromeEvent } from './fixtures/chrome-event';

vi.mock('../src/shared/storage', () => ({
  isExtension: true,
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

let root: Root;
let stored: Settings;
const openOptionsPage = vi.fn();
const queryTabs = vi.fn();
const connectTab = vi.fn();
let initialPageStatus: unknown;
let tabActivated = createChromeEvent<[]>();
let tabUpdated = createChromeEvent<[number, chrome.tabs.TabChangeInfo]>();
let ports: ReturnType<typeof createStatusPort>[];
const getManifest = () => ({ version: '0.1.1' });
const pageValues = new Map<string, string>();

function createStatusPort(initial: unknown) {
  const onMessage = createChromeEvent<[unknown]>();
  const onDisconnect = createChromeEvent<[]>();
  queueMicrotask(() => onMessage.emit(initial));
  return {
    onMessage,
    onDisconnect,
    disconnect: vi.fn(() => onDisconnect.emit()),
  };
}

beforeEach(() => {
  pageValues.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => pageValues.get(key) ?? null,
    setItem: (key: string, value: string) => pageValues.set(key, value),
    removeItem: (key: string) => pageValues.delete(key),
  });
  stored = {
    ...structuredClone(DEFAULT_SETTINGS),
    provider: 'openai',
    apiKey: 'test-key',
    model: 'provider/model-id',
  };
  vi.mocked(loadSettings)
    .mockReset()
    .mockImplementation(async () => structuredClone(stored));
  vi.mocked(saveSettings)
    .mockReset()
    .mockImplementation(async (value) => {
      stored = applySettingsPatch(stored, value);
      return structuredClone(stored);
    });
  openOptionsPage.mockReset().mockResolvedValue(undefined);
  queryTabs.mockReset().mockResolvedValue([{ id: 7, url: 'https://x.com/user/status/1' }]);
  initialPageStatus = 'bilingual';
  tabActivated = createChromeEvent<[]>();
  tabUpdated = createChromeEvent<[number, chrome.tabs.TabChangeInfo]>();
  ports = [];
  connectTab.mockReset().mockImplementation(() => {
    const port = createStatusPort(initialPageStatus);
    ports.push(port);
    return port;
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    runtime: { openOptionsPage, getManifest },
    tabs: {
      query: queryTabs,
      connect: connectTab,
      onActivated: tabActivated,
      onUpdated: tabUpdated,
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
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
  await choose('target', 'ko');
  expect(stored).toMatchObject({
    targetLanguage: 'ko',
    model: 'provider/new-model',
    apiKey: 'new-key',
    translation: { size: 32 },
  });
  expect(select('target').value).toBe('ko');
  expect(document.querySelector('.popup-model-id')?.textContent).toBe('provider/new-model');
});

it.each([
  { providerConsent: '', hint: 'Allow subtitles to be sent to your provider in settings.' },
  { providerConsent: 'https://api.openai.com', hint: undefined },
])('asks for consent when the configured Provider has none: $providerConsent', async (row) => {
  stored.providerConsent = row.providerConsent;
  await render();
  expect(document.querySelector('.popup-setup-hint')?.textContent).toBe(row.hint);
  expect(document.querySelector('.popup-setup-hint')?.closest('details')).toBeFalsy();
});

it('offers one translation-language control with all supported languages', async () => {
  await render();
  expect(document.querySelectorAll('select')).toHaveLength(1);
  expect([...select('target').options].map((option) => [option.value, option.text])).toEqual([
    ['en', 'English'],
    ['zh-CN', 'Simplified Chinese'],
    ['zh-TW', 'Traditional Chinese'],
    ['ja', 'Japanese'],
    ['ko', 'Korean'],
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
    (patch) =>
      new Promise<Settings>((resolve) => {
        finish = () => {
          stored = applySettingsPatch(stored, patch);
          resolve(structuredClone(stored));
        };
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
    tabs: {
      query: queryTabs,
      connect: connectTab,
      onActivated: tabActivated,
      onUpdated: tabUpdated,
    },
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
  expect(document.querySelector('.popup')?.getAttribute('aria-busy')).toBe('false');
  expect(select('target').matches(':disabled')).toBe(true);
  expect(select('target').selectedOptions[0].textContent).toBe('Could not load');
  expect(document.querySelector('.popup-model-empty')?.textContent).toBe('Could not load');
  expect(document.querySelector('.popup-usage-total')?.textContent).toBe('Could not load');
  expect(document.querySelector('[role="switch"]')?.matches(':disabled')).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    'Could not load settings. Reopen the extension.',
  );
  await click('.popup-settings');
  expect(openOptionsPage).toHaveBeenCalledOnce();
  expect(saveSettings).not.toHaveBeenCalled();
});

it('keeps model and token details collapsed while settings and page status stay visible', async () => {
  await render();
  expect(document.querySelector<HTMLDetailsElement>('details')!.open).toBe(false);
  expect(document.querySelector('summary')?.textContent).toBe('Model and usage');
  expect(document.querySelector('details .popup-model-id')?.textContent).toBe('provider/model-id');
  expect(document.querySelector('details .popup-usage-total')).not.toBeNull();
  expect(document.querySelector('.popup-settings')?.textContent).toBe('Settings');
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    'Showing bilingual subtitles',
  );
  expect(connectTab).toHaveBeenCalledWith(7, { name: 'page-status', frameId: 0 });
});

it('updates the open popup as captions are disabled, enabled, and shown in translation-only mode', async () => {
  vi.useFakeTimers();
  await render();
  const status = () => document.querySelector('[aria-label="Page status"]')?.textContent;
  expect(status()).toBe('Showing bilingual subtitles');
  await click('[role="switch"]');
  await act(async () => ports[0].onMessage.emit('disabled'));
  expect(status()).toBe('Subtitles are off');
  await click('[role="switch"]');
  await act(async () => ports[0].onMessage.emit('waiting'));
  expect(status()).toBe('Waiting for captions');
  await act(async () => ports[0].onMessage.emit('loading'));
  expect(status()).toBe('Translating the current caption');
  await act(async () => ports[0].onMessage.emit('bilingual'));
  expect(status()).toBe('Showing bilingual subtitles');
  await click('.popup-translation-only input[type="checkbox"]');
  await act(async () => ports[0].onMessage.emit('translation-only'));
  expect(status()).toBe('Showing translated subtitles');
});

it('follows active tabs and ignores status updates from the previous page', async () => {
  await render();
  const previous = ports[0];
  queryTabs.mockResolvedValue([{ id: 9, url: 'https://www.youtube.com/watch?v=other' }]);
  connectTab.mockImplementationOnce(() => {
    const port = createStatusPort('waiting');
    ports.push(port);
    return port;
  });
  await act(async () => tabActivated.emit());
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    'Waiting for captions',
  );
  await act(async () => previous.onMessage.emit('bilingual'));
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    'Waiting for captions',
  );
  await act(async () => ports[1].onMessage.emit('translation-only'));
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    'Showing translated subtitles',
  );
});

it.each([undefined, { enabled: true }, 'ready'])(
  'does not infer a working page from an invalid status reply: %s',
  async (response) => {
    initialPageStatus = response;
    await render();
    expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
      "Could not read this page's status",
    );
  },
);

it('distinguishes unsupported pages from a disconnected content script and reconnects after navigation', async () => {
  await render();
  await act(async () => ports[0].onDisconnect.emit());
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    "Could not read this page's status",
  );
  await act(async () => tabUpdated.emit(9, { status: 'complete' }));
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    "Could not read this page's status",
  );
  initialPageStatus = 'original';
  await act(async () => tabUpdated.emit(7, { status: 'complete' }));
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    'Showing original subtitles',
  );
  queryTabs.mockResolvedValue([{ id: 7, url: 'https://example.org/' }]);
  await act(async () => tabUpdated.emit(7, { url: 'https://example.org/' }));
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    'Subtitles are not supported on this page',
  );
});

it('discards an earlier tab lookup when the active tab changes again', async () => {
  await render();
  let finish!: (tabs: { id: number; url: string }[]) => void;
  queryTabs.mockImplementationOnce(
    () => new Promise<{ id: number; url: string }[]>((resolve) => (finish = resolve)),
  );
  await act(async () => tabActivated.emit());
  queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.org/' }]);
  await act(async () => tabActivated.emit());
  await act(async () => finish([{ id: 7, url: 'https://x.com/user/status/1' }]));
  expect(document.querySelector('[aria-label="Page status"]')?.textContent).toBe(
    'Subtitles are not supported on this page',
  );
});

it('stops following tabs when the popup closes', async () => {
  await render();
  await act(async () => root.render(null));
  queryTabs.mockClear();
  await act(async () => {
    tabActivated.emit();
    tabUpdated.emit(7, { status: 'complete' });
    ports[0].onMessage.emit('disabled');
  });
  expect(queryTabs).not.toHaveBeenCalled();
  expect(ports[0].disconnect).toHaveBeenCalledOnce();
});
