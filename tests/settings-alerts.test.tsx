import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  environment.extension = true;
  vi.mocked(loadSettings).mockResolvedValue({
    ...structuredClone(DEFAULT_SETTINGS),
    apiKey: 'test-key',
    model: 'test-model',
  });
  vi.mocked(allowApiHost).mockResolvedValue(undefined);
  vi.mocked(loadCachedModels).mockResolvedValue([]);
  vi.mocked(saveCachedModels).mockResolvedValue(undefined);
  vi.mocked(saveSettings).mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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

it.each(['preview', 'load-error', 'save'] as const)(
  'shows %s feedback outside the scrolling page and dismisses it automatically',
  async (source) => {
    if (source === 'preview') environment.extension = false;
    if (source === 'load-error')
      vi.mocked(loadSettings).mockRejectedValue(new Error('Unavailable'));
    await render();
    if (source === 'save') {
      await click('[aria-label="启用双语字幕"]');
      await click('.save-button');
      expect(saveSettings).toHaveBeenCalledOnce();
    }
    const notice = document.querySelector('.settings-alert')!;
    expect(notice.getAttribute('role')).toBe(source === 'load-error' ? 'alert' : 'status');
    expect(notice.textContent).toContain(
      source === 'preview'
        ? '浏览器预览'
        : source === 'load-error'
          ? '无法读取本地设置'
          : '设置已保存',
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

it('shows only a brief connection success alert and gives its replacement a full lifetime', async () => {
  vi.mocked(apiAction)
    .mockResolvedValueOnce('世界充满了美妙的事物。')
    .mockResolvedValueOnce(['model-a', 'model-b']);
  await render();
  await click('.test-button');
  expect(apiAction).toHaveBeenLastCalledWith('test', expect.any(Object));
  const notice = document.querySelector('.settings-alert')!;
  expect(document.querySelectorAll('.settings-alert')).toHaveLength(1);
  expect(notice.textContent).toBe('连接测试成功');
  expect(document.querySelector('.test-result')).toBeNull();
  await advance(4900);
  await click('.fetch-button');
  expect(document.querySelectorAll('.settings-alert')).toHaveLength(1);
  expect(document.querySelector('.settings-alert')).not.toBe(notice);
  await advance(300);
  expect(document.querySelector('.settings-alert')?.textContent).toContain('已获取 2 个模型');
  await advance(4700);
  await advance(180);
  expect(document.querySelector('.settings-alert')).toBeNull();
});

it('restarts the lifetime for identical validation errors and allows manual dismissal', async () => {
  vi.mocked(loadSettings).mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
  await render();
  await click('.test-button');
  const first = document.querySelector('[role="alert"]')!;
  expect(first.textContent).toContain('请先填写 API Key');
  await advance(4900);
  await click('.test-button');
  expect(document.querySelector('[role="alert"]')).not.toBe(first);
  await advance(300);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('请先填写 API Key');
  expect(apiAction).not.toHaveBeenCalled();
  await click('[aria-label="关闭提示"]');
  await advance(180);
  expect(document.querySelector('.alert-layer')).toBeNull();
  await advance(5000);
  expect(document.querySelector('.alert-layer')).toBeNull();
});

it('uses the same dismissible error alert for provider and save failures', async () => {
  vi.mocked(apiAction).mockRejectedValue(new Error('API Key 无效或已过期。'));
  vi.mocked(saveSettings).mockRejectedValue(new Error('保存失败，请重试。'));
  await render();
  await click('.test-button');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('API Key 无效或已过期');
  await click('[aria-label="启用双语字幕"]');
  await click('.save-button');
  expect(document.querySelectorAll('.settings-alert')).toHaveLength(1);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('保存失败，请重试');
  await advance(5000);
  await advance(180);
  expect(document.querySelector('.settings-alert')).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('.save-button')!.disabled).toBe(false);
});
