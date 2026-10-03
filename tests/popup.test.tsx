import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import { loadSettings, saveSettings } from '../src/shared/storage';
import { Popup } from '../src/ui/Popup';

vi.mock('../src/shared/storage', () => ({
  isExtension: true,
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

let root: Root;
let stored: Settings;
const openOptionsPage = vi.fn();

beforeEach(() => {
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
  vi.stubGlobal('chrome', { runtime: { openOptionsPage } });
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
  await choose('source', 'ja');
  await choose('target', 'ko');
  expect(stored).toMatchObject({
    sourceLanguage: 'ja',
    targetLanguage: 'ko',
    model: 'provider/new-model',
    apiKey: 'new-key',
    translation: { size: 32 },
  });
  expect(select('source').value).toBe('ja');
  expect(select('target').value).toBe('ko');
  expect(document.querySelector('.popup-model-id')?.textContent).toBe('provider/new-model');
  expect(document.querySelector('[role="status"]')?.textContent).toBe('已保存');
});

it('swaps both languages in one save and prevents selecting identical languages', async () => {
  await render();
  expect(select('source').querySelector<HTMLOptionElement>('option[value="zh-CN"]')?.disabled).toBe(
    true,
  );
  expect(select('target').querySelector<HTMLOptionElement>('option[value="en"]')?.disabled).toBe(
    true,
  );
  await click('[aria-label="互换原文和译文语言"]');
  expect(stored).toMatchObject({ sourceLanguage: 'zh-CN', targetLanguage: 'en' });
  expect(saveSettings).toHaveBeenCalledTimes(1);
  expect(select('source').value).toBe('zh-CN');
  expect(select('target').value).toBe('en');
});

it('rejects a language that conflicts with a newer settings change', async () => {
  await render();
  stored.targetLanguage = 'ja';
  await choose('source', 'ja');
  expect(saveSettings).not.toHaveBeenCalled();
  expect(select('source').value).toBe('en');
  expect(select('target').value).toBe('ja');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('原文和译文语言需要不同。');
});

it('toggles the extension without requiring a configured provider and keeps languages editable', async () => {
  stored.apiKey = '';
  stored.model = '';
  await render();
  await click('[role="switch"]');
  expect(stored.enabled).toBe(false);
  expect(document.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  expect(select('source').matches(':disabled')).toBe(false);
  await click('[role="switch"]');
  expect(stored.enabled).toBe(true);
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
  expect(select('source').matches(':disabled')).toBe(true);
  expect(document.querySelector('[role="switch"]')?.matches(':disabled')).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('正在保存…');
  await act(async () => finish());
  expect(select('source').matches(':disabled')).toBe(false);
  expect(document.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
});

it('restores the saved language after a write failure and clears the error after retrying', async () => {
  await render();
  vi.mocked(saveSettings).mockRejectedValueOnce(new Error('Storage unavailable'));
  await choose('source', 'fr');
  expect(stored.sourceLanguage).toBe('en');
  expect(select('source').value).toBe('en');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('保存失败，请重试。');
  expect(select('source').matches(':disabled')).toBe(false);
  await choose('source', 'fr');
  expect(stored.sourceLanguage).toBe('fr');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('keeps controls disabled after a load failure and leaves settings accessible', async () => {
  vi.mocked(loadSettings).mockRejectedValueOnce(new Error('Storage unavailable'));
  await render();
  expect(select('source').matches(':disabled')).toBe(true);
  expect(document.querySelector('[role="switch"]')?.matches(':disabled')).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    '无法读取设置，请重新打开扩展。',
  );
  await click('.popup-settings');
  expect(openOptionsPage).toHaveBeenCalledOnce();
  expect(saveSettings).not.toHaveBeenCalled();
});
