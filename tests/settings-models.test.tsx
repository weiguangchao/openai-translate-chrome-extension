import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import {
  allowApiHost,
  apiAction,
  loadCachedModels,
  loadSettings,
  saveCachedModels,
  saveSettings,
} from '../src/shared/storage';
import { App } from '../src/ui/App';

vi.mock('../src/shared/storage', () => ({
  isExtension: true,
  allowApiHost: vi.fn(),
  apiAction: vi.fn(),
  loadCachedModels: vi.fn(),
  loadSettings: vi.fn(),
  saveCachedModels: vi.fn(),
  saveSettings: vi.fn(),
}));

let root: Root;
let settings: Settings;

beforeEach(() => {
  vi.resetAllMocks();
  settings = { ...structuredClone(DEFAULT_SETTINGS), apiKey: 'test-key', model: 'chosen-model' };
  vi.mocked(loadSettings).mockImplementation(async () => structuredClone(settings));
  vi.mocked(loadCachedModels).mockResolvedValue(['cached-a', 'cached-b']);
  vi.mocked(saveCachedModels).mockResolvedValue(undefined);
  vi.mocked(allowApiHost).mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.1.2' }) } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function render() {
  await act(async () => root.render(<App />));
}

async function fetchModels() {
  await act(async () => document.querySelector<HTMLButtonElement>('.fetch-button')!.click());
}

function options() {
  return [...document.querySelectorAll<HTMLOptionElement>('#model option')].map(
    (option) => option.value,
  );
}

async function edit(id: string, value: string) {
  await act(async () => {
    const input = document.getElementById(id)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('restores the cached list and keeps the selected model without requesting the provider', async () => {
  await render();
  expect(options()).toEqual(['', 'chosen-model', 'cached-a', 'cached-b']);
  expect(document.querySelector<HTMLSelectElement>('#model')!.value).toBe('chosen-model');
  expect(apiAction).not.toHaveBeenCalled();
  expect(saveSettings).not.toHaveBeenCalled();
});

it('updates each successful refresh immediately and requests model-cache persistence', async () => {
  vi.mocked(apiAction)
    .mockResolvedValueOnce(['model-a', 'model-b'])
    .mockResolvedValueOnce(['model-a', 'model-c']);
  await render();
  await fetchModels();
  expect(saveCachedModels).toHaveBeenLastCalledWith(settings, ['model-a', 'model-b']);
  expect(options()).toEqual(['', 'chosen-model', 'model-a', 'model-b']);
  await fetchModels();
  expect(saveCachedModels).toHaveBeenLastCalledWith(settings, ['model-a', 'model-c']);
  expect(options()).toEqual(['', 'chosen-model', 'model-a', 'model-c']);
  expect(saveCachedModels).toHaveBeenCalledTimes(2);
  expect(apiAction).toHaveBeenCalledTimes(2);
  expect(saveSettings).not.toHaveBeenCalled();
});

it('reloads the matching cache when the provider URL or API key changes', async () => {
  vi.mocked(loadCachedModels).mockImplementation(async (provider) => {
    if (provider.baseUrl !== settings.baseUrl) return ['other-provider'];
    return provider.apiKey === settings.apiKey ? ['original-account'] : ['other-account'];
  });
  await render();
  await edit('api-key', 'other-key');
  expect(options()).toEqual(['', 'chosen-model', 'other-account']);
  await edit('base-url', 'https://other.example/v1');
  expect(options()).toEqual(['', 'chosen-model', 'other-provider']);
  await edit('base-url', settings.baseUrl);
  await edit('api-key', settings.apiKey);
  expect(options()).toEqual(['', 'chosen-model', 'original-account']);
  expect(apiAction).not.toHaveBeenCalled();
});

it('does not let a slow cache read overwrite a freshly fetched list', async () => {
  let resolveCache!: (ids: string[]) => void;
  vi.mocked(loadCachedModels).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveCache = resolve;
    }),
  );
  vi.mocked(apiAction).mockResolvedValue(['fresh-model']);
  await render();
  await fetchModels();
  await act(async () => resolveCache(['stale-model']));
  expect(options()).toEqual(['', 'chosen-model', 'fresh-model']);
});

it('retains the last successful list after a failed refresh', async () => {
  vi.mocked(apiAction).mockRejectedValue(new Error('API request failed.'));
  await render();
  await fetchModels();
  expect(options()).toEqual(['', 'chosen-model', 'cached-a', 'cached-b']);
  expect(saveCachedModels).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('API request failed.');
});

it('keeps fetched models usable but reports that persistence failed', async () => {
  vi.mocked(apiAction).mockResolvedValue(['fresh-model']);
  vi.mocked(saveCachedModels).mockRejectedValue(
    new Error('Models were fetched but could not be cached locally. Try again.'),
  );
  await render();
  await fetchModels();
  expect(options()).toEqual(['', 'chosen-model', 'fresh-model']);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'could not be cached locally',
  );
  expect(document.querySelector<HTMLButtonElement>('.fetch-button')!.disabled).toBe(false);
});
