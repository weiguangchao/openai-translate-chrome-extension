import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import {
  allowApiHost,
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

const REPOSITORY = 'https://github.com/weiguangchao/openai-translate-chrome-extension';
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  environment.extension = false;
  vi.mocked(loadSettings).mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
  vi.mocked(allowApiHost).mockResolvedValue(undefined);
  vi.mocked(loadCachedModels).mockResolvedValue([]);
  vi.mocked(saveCachedModels).mockResolvedValue(undefined);
  vi.mocked(saveSettings).mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollTo = () => {};
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('links the repository and the author on the about page', async () => {
  await act(async () => root.render(<App />));
  const about = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'About',
  );
  await act(async () => about!.click());

  const repository = document.querySelector<HTMLAnchorElement>('a[aria-label="GitHub repository"]');
  expect(repository?.getAttribute('href')).toBe(REPOSITORY);
  expect(repository?.getAttribute('target')).toBe('_blank');
  expect(repository?.getAttribute('rel')).toBe('noreferrer');
  expect(document.querySelector('a[aria-label="Author on X"]')?.getAttribute('href')).toBe(
    'https://x.com/itbuxiangma',
  );
});
