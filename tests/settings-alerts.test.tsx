import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, applySettingsPatch, type Settings } from '../src/shared/settings';
import {
  allowApiHost,
  apiAction,
  loadCachedModels,
  loadSettings,
  saveCachedModels,
  saveSettings,
} from '../src/shared/storage';
import { App } from '../src/ui/App';

const environment = vi.hoisted(() => ({ extension: true }));
vi.mock('../src/shared/storage', () => ({
  get isExtension() {
    return environment.extension;
  },
  allowApiHost: vi.fn(),
  apiAction: vi.fn(),
  loadCachedModels: vi.fn(),
  loadSettings: vi.fn(),
  saveCachedModels: vi.fn(),
  saveSettings: vi.fn(),
}));

let root: Root;
let stored: Settings;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  environment.extension = true;
  stored = {
    ...structuredClone(DEFAULT_SETTINGS),
    apiKey: 'test-key',
    model: 'test-model',
  };
  vi.mocked(loadSettings).mockImplementation(async () => structuredClone(stored));
  vi.mocked(allowApiHost).mockResolvedValue(undefined);
  vi.mocked(loadCachedModels).mockResolvedValue([]);
  vi.mocked(saveCachedModels).mockResolvedValue(undefined);
  vi.mocked(saveSettings).mockImplementation(async (patch) => {
    stored = applySettingsPatch(stored, patch);
    return structuredClone(stored);
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.1.2' }) } });
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
  await act(async () => root.render(<App />));
}

async function click(selector: string) {
  await act(async () => document.querySelector<HTMLButtonElement>(selector)!.click());
}

async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTime(milliseconds));
}

it('keeps edits made while saving as an unsaved draft', async () => {
  let finish!: () => void;
  vi.mocked(saveSettings).mockImplementationOnce(
    (patch) =>
      new Promise((resolve) => {
        finish = () => {
          stored = applySettingsPatch(stored, patch);
          resolve(structuredClone(stored));
        };
      }),
  );
  await render();
  await click('[aria-label="Enable bilingual subtitles"]');
  await click('.save-button');
  await click('[aria-label="Enable bilingual subtitles"]');
  await act(async () => finish());
  expect(
    document
      .querySelector('[aria-label="Enable bilingual subtitles"]')
      ?.getAttribute('aria-checked'),
  ).toBe('true');
  expect(document.querySelector('.save-button')?.textContent).toContain('Save changes');
  expect(document.querySelector<HTMLButtonElement>('.save-button')!.disabled).toBe(false);
});

it.each(['preview', 'load-error', 'save'] as const)(
  'shows %s feedback outside the scrolling page and dismisses it automatically',
  async (source) => {
    if (source === 'preview') environment.extension = false;
    if (source === 'load-error')
      vi.mocked(loadSettings).mockRejectedValue(new Error('Unavailable'));
    await render();
    if (source === 'save') {
      await click('[aria-label="Enable bilingual subtitles"]');
      await click('.save-button');
      expect(saveSettings).toHaveBeenCalledOnce();
    }
    const notice = document.querySelector('.settings-alert')!;
    expect(notice.getAttribute('role')).toBe(source === 'load-error' ? 'alert' : 'status');
    expect(notice.textContent).toContain(
      source === 'preview'
        ? 'Browser preview'
        : source === 'load-error'
          ? 'Could not load local settings'
          : 'Settings saved',
    );
    expect(document.querySelector('.alert-layer')?.parentElement).toBe(document.body);
    expect(document.querySelector('.workspace .settings-alert')).toBeNull();
    await advance(4999);
    expect(document.querySelector('.settings-alert')).toBe(notice);
    await advance(1);
    expect(notice.classList.contains('is-closing')).toBe(true);
    await advance(180);
    expect(document.querySelector('.alert-layer')).toBeNull();
  },
);

it('records consent for the Provider host only when the viewer ticks it and asks again for a new host', async () => {
  await render();
  const consent = () => document.querySelector<HTMLInputElement>('.consent-check input')!;
  expect(consent().checked).toBe(false);
  expect(document.querySelector('.consent-check')?.textContent).toContain('api.openai.com');
  await click('[aria-label="Enable bilingual subtitles"]');
  await click('.save-button');
  expect(stored.providerConsent).toBe('');
  expect(document.querySelector('.settings-alert')?.textContent).toContain(
    'Accept the data use notice to translate subtitles',
  );
  await act(async () => consent().click());
  await click('.save-button');
  expect(stored.providerConsent).toBe('https://api.openai.com');
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('#base-url')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'https://other.example/v1',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(consent().checked).toBe(false);
  expect(document.querySelector('.consent-check')?.textContent).toContain('other.example');
});

it('shows only a brief connection success alert and gives its replacement a full lifetime', async () => {
  vi.mocked(apiAction)
    .mockResolvedValueOnce('世界充满了美妙的事物。')
    .mockResolvedValueOnce(['model-a', 'model-b']);
  await render();
  await click('.test-button');
  expect(apiAction).toHaveBeenLastCalledWith('test', expect.any(Object));
  const notice = document.querySelector('.settings-alert')!;
  expect(document.querySelectorAll('.settings-alert')).toHaveLength(1);
  expect(notice.textContent).toBe('Connection test passed');
  expect(document.querySelector('.test-result')).toBeNull();
  await advance(4900);
  await click('.fetch-button');
  expect(document.querySelectorAll('.settings-alert')).toHaveLength(1);
  expect(document.querySelector('.settings-alert')).not.toBe(notice);
  await advance(300);
  expect(document.querySelector('.settings-alert')?.textContent).toContain('Fetched 2 models');
  await advance(4700);
  await advance(180);
  expect(document.querySelector('.settings-alert')).toBeNull();
});

it('restarts the lifetime for identical validation errors and allows manual dismissal', async () => {
  vi.mocked(loadSettings).mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
  await render();
  await click('.test-button');
  const first = document.querySelector('[role="alert"]')!;
  expect(first.textContent).toContain('Enter an API Key');
  await advance(4900);
  await click('.test-button');
  expect(document.querySelector('[role="alert"]')).not.toBe(first);
  await advance(300);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Enter an API Key');
  expect(apiAction).not.toHaveBeenCalled();
  await click('[aria-label="Dismiss notification"]');
  await advance(180);
  expect(document.querySelector('.alert-layer')).toBeNull();
  await advance(5000);
  expect(document.querySelector('.alert-layer')).toBeNull();
});

it('uses the same dismissible error alert for provider and save failures', async () => {
  vi.mocked(apiAction).mockRejectedValue(new Error('The API Key is invalid or expired.'));
  vi.mocked(saveSettings).mockRejectedValue(new Error('Could not save. Try again.'));
  await render();
  await click('.test-button');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'The API Key is invalid or expired',
  );
  await click('[aria-label="Enable bilingual subtitles"]');
  await click('.save-button');
  expect(document.querySelectorAll('.settings-alert')).toHaveLength(1);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Could not save. Try again',
  );
  await advance(5000);
  await advance(180);
  expect(document.querySelector('.settings-alert')).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('.save-button')!.disabled).toBe(false);
});
