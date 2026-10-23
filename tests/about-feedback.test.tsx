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
  vi.mocked(saveSettings).mockResolvedValue(undefined);
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

it('opens the repository and a new GitHub issue from the about page', async () => {
  await act(async () => root.render(<App />));
  const about = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'About',
  );
  await act(async () => about!.click());

  const repository = document.querySelector<HTMLAnchorElement>('a[aria-label="GitHub repository"]');
  const feedback = [...document.querySelectorAll('a')].find(
    (link) => link.textContent?.trim() === 'Feedback',
  );
  expect(repository?.getAttribute('href')).toBe(REPOSITORY);
  expect(repository?.getAttribute('target')).toBe('_blank');
  expect(repository?.getAttribute('rel')).toBe('noreferrer');
  expect(feedback?.getAttribute('href')).toBe(`${REPOSITORY}/issues/new`);
  expect(feedback?.getAttribute('target')).toBe('_blank');
  expect(feedback?.getAttribute('rel')).toBe('noreferrer');
  expect(document.querySelector('textarea')).toBeNull();
  expect([...document.querySelectorAll('h2')].map((heading) => heading.textContent)).not.toContain(
    'Project and feedback',
  );
});
