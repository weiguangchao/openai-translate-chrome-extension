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
  window.history.replaceState(null, '', location.pathname);
  environment.extension = true;
  stored = {
    ...structuredClone(DEFAULT_SETTINGS),
    provider: 'openai',
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

async function navigate(name: string) {
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('nav button')]
      .find((button) => button.textContent === name)!
      .click(),
  );
}

async function render(page = 'general') {
  if (page === 'service') window.history.replaceState(null, '', '#service');
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
  await click('[aria-label="Enable subtitles"]');
  await click('.save-button');
  await click('[aria-label="Enable subtitles"]');
  await act(async () => finish());
  expect(
    document.querySelector('[aria-label="Enable subtitles"]')?.getAttribute('aria-checked'),
  ).toBe('true');
  expect(document.querySelector('.save-button')?.textContent).toContain('Save changes');
  expect(document.querySelector<HTMLButtonElement>('.save-button')!.disabled).toBe(false);
});

it('keeps the browser preview notice inline without covering settings', async () => {
  environment.extension = false;
  await render('service');
  expect(document.querySelector('.browser-preview-note')?.textContent).toContain('Browser preview');
  expect(document.querySelector('.settings-alert')).toBeNull();
});

it('shows save feedback outside the scrolling page and dismisses it automatically', async () => {
  await render();
  await click('[aria-label="Enable subtitles"]');
  await click('.save-button');
  expect(saveSettings).toHaveBeenCalledOnce();
  const notice = document.querySelector('.settings-alert')!;
  expect(notice.getAttribute('role')).toBe('status');
  expect(notice.textContent).toContain('Settings saved');
  expect(document.querySelector('.alert-layer')?.parentElement).toBe(document.body);
  expect(document.querySelector('.workspace .settings-alert')).toBeNull();
  await advance(4999);
  expect(document.querySelector('.settings-alert')).toBe(notice);
  await advance(1);
  expect(notice.classList.contains('is-closing')).toBe(true);
  await advance(180);
  expect(document.querySelector('.alert-layer')).toBeNull();
});

it('discards edits across pages while keeping the persisted settings intact', async () => {
  await render();
  document.querySelector<HTMLElement>('.workspace')!.scrollTo = vi.fn();
  await click('[aria-label="Enable subtitles"]');
  await click('input[name="settings-display-mode"][value="true"]');
  const navigate = async (name: string) => {
    await act(async () =>
      [...document.querySelectorAll('nav button')]
        .find((button) => button.textContent === name)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
  };
  await navigate('About');
  expect(document.querySelector('.save-button')?.textContent).toContain('Save changes');
  expect(document.activeElement?.tagName).toBe('H1');
  await click('.discard-button');
  await navigate('General');
  expect(
    document.querySelector('[aria-label="Enable subtitles"]')?.getAttribute('aria-checked'),
  ).toBe(String(stored.enabled));
  expect(
    document.querySelector<HTMLInputElement>('input[name="settings-display-mode"][value="false"]')
      ?.checked,
  ).toBe(true);
  expect(document.querySelector('.discard-button')).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('.save-button')?.disabled).toBe(true);
  expect(saveSettings).not.toHaveBeenCalled();
});

it('opens a linked section and keeps drafts when browser history changes sections', async () => {
  await render('service');
  expect(document.querySelector('h1')?.textContent).toBe('Translation service');
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[value="microsoft"]')!.click(),
  );
  await navigate('General');
  await click('[aria-label="Enable subtitles"]');
  await act(async () => {
    window.history.replaceState(null, '', '#service');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(document.querySelector('h1')?.textContent).toBe('Translation service');
  expect(document.querySelector<HTMLInputElement>('input[value="microsoft"]')?.checked).toBe(true);
  await click('.discard-button');
  await navigate('General');
  expect(
    document.querySelector('[aria-label="Enable subtitles"]')?.getAttribute('aria-checked'),
  ).toBe('true');
  expect(saveSettings).not.toHaveBeenCalled();
});

it.each([
  { consent: '', model: 'test-model', setup: true },
  { consent: 'https://api.openai.com', model: 'test-model', setup: false },
  { consent: 'https://api.openai.com', model: '', setup: true },
])(
  'shows an actionable service shortcut with the correct setup state: $setup, $model',
  async ({ consent, model, setup }) => {
    stored.providerConsent = consent;
    stored.model = model;
    await render();
    const shortcut = document.querySelector<HTMLButtonElement>('.service-shortcut')!;
    expect(shortcut.classList.contains('needs-setup')).toBe(setup);
    expect(Boolean(shortcut.querySelector('.setup-badge'))).toBe(setup);
    expect(shortcut.textContent).toContain(
      setup
        ? model
          ? 'Review caption data consent'
          : 'Finish translation setup'
        : 'Translation service',
    );
    expect(shortcut.querySelector('.service-shortcut-value')?.textContent).toContain(
      'OpenAI-compatible',
    );
    expect(shortcut.querySelector('.service-shortcut-model')?.textContent ?? '').toBe(model);
    if (setup) expect(document.querySelector('.settings-column')?.firstElementChild).toBe(shortcut);
    await act(async () => shortcut.click());
    expect(document.querySelector('h1')?.textContent).toBe('Translation service');
    expect(document.querySelector<HTMLInputElement>('input[value="openai"]')?.checked).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
  },
);

it.each(['General', 'Subtitle style', 'About', 'Translation service'])(
  'returns to an invalid Base URL when saving from %s and preserves the draft',
  async (section) => {
    await render('service');
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('#base-url')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'invalid-url',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await navigate(section);
    await click('.save-button');
    const input = document.querySelector<HTMLInputElement>('#base-url')!;
    expect(document.querySelector('h1')?.textContent).toBe('Translation service');
    expect(input.value).toBe('invalid-url');
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain(
      'Enter a complete Base URL',
    );
    expect(saveSettings).not.toHaveBeenCalled();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'https://corrected.example/v1',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(document.querySelector('#base-url-error')).toBeNull();
    await click('.save-button');
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(stored.baseUrl).toBe('https://corrected.example/v1');
  },
);

it('does not reset scroll or focus after the hashchange caused by in-app validation navigation', async () => {
  stored.baseUrl = 'invalid-url';
  await render();
  await click('[aria-label="Enable subtitles"]');
  const scroll = vi.fn();
  document.querySelector<HTMLElement>('.workspace')!.scrollTo = scroll;
  await click('.save-button');
  const input = document.querySelector<HTMLInputElement>('#base-url')!;
  expect(document.activeElement).toBe(input);
  scroll.mockClear();
  await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));
  expect(scroll).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  expect(document.querySelector('.alert-layer')).toBeNull();
});

it('shows an invalid URL inline for a connection test without starting a provider request', async () => {
  stored.baseUrl = 'invalid-url';
  await render('service');
  await click('.test-button');
  expect(document.querySelector('#base-url-error')?.textContent).toContain(
    'Enter a complete Base URL',
  );
  expect(document.activeElement?.id).toBe('base-url');
  expect(document.querySelector('.connection-badge')?.textContent).toBe('Test failed');
  expect(document.querySelector('.alert-layer')).toBeNull();
  expect(apiAction).not.toHaveBeenCalled();
});

it('keeps Microsoft consent when the OpenAI caption consent changes', async () => {
  stored.providerConsent = 'https://api.openai.com,https://edge.microsoft.com';
  await render('service');
  await click('.consent-check input');
  await click('.save-button');
  expect(stored.providerConsent).toBe('https://edge.microsoft.com');
  await click('.consent-check input');
  await click('.save-button');
  expect(new Set(stored.providerConsent.split(','))).toEqual(
    new Set(['https://edge.microsoft.com', 'https://api.openai.com']),
  );
});

it('keeps a failed settings load visible and retries without presenting unsaved defaults', async () => {
  let finish!: (settings: Settings) => void;
  vi.mocked(loadSettings)
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  await render();
  expect(document.querySelector('.workspace')?.getAttribute('aria-busy')).toBe('false');
  expect(document.querySelector('.save-button')).toBeNull();
  expect(document.querySelector('#provider')).toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Could not load local settings',
  );
  await advance(6000);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Could not load local settings',
  );
  await click('.settings-state button');
  expect(document.querySelector('.workspace')?.getAttribute('aria-busy')).toBe('true');
  expect(document.querySelector('.settings-state')?.textContent).toBe('Loading settings…');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  const recovered = { ...stored, targetLanguage: 'ko', enabled: false };
  await act(async () => finish(recovered));
  expect(loadSettings).toHaveBeenCalledTimes(2);
  expect(document.querySelector('.workspace')?.getAttribute('aria-busy')).toBe('false');
  expect(document.querySelector('.settings-state')).toBeNull();
  expect(document.querySelector<HTMLSelectElement>('#target-language')?.value).toBe('ko');
  expect(
    document.querySelector('[aria-label="Enable subtitles"]')?.getAttribute('aria-checked'),
  ).toBe('false');
  expect(document.querySelector('.save-button')?.textContent).toContain('Settings saved');
  expect(document.querySelector<HTMLButtonElement>('.save-button')?.disabled).toBe(true);
  expect(saveSettings).not.toHaveBeenCalled();
});

it('records consent for the Provider host only when the viewer ticks it and asks again for a new host', async () => {
  await render('service');
  const consent = () => document.querySelector<HTMLInputElement>('.consent-check input')!;
  expect(consent().checked).toBe(false);
  expect(document.querySelector('.consent-check')?.textContent).toContain('api.openai.com');
  await navigate('General');
  await click('[aria-label="Enable subtitles"]');
  await click('.save-button');
  await navigate('Translation service');
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
  await render('service');
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
  vi.mocked(loadSettings).mockResolvedValue({
    ...structuredClone(DEFAULT_SETTINGS),
    provider: 'openai',
  });
  await render('service');
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
  await render('service');
  await click('.test-button');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'The API Key is invalid or expired',
  );
  await navigate('General');
  await click('[aria-label="Enable subtitles"]');
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

it('keeps saving independent of connection tests and retains a failed result after the alert closes', async () => {
  let finish!: () => void;
  vi.mocked(apiAction).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve('测试译文');
      }),
  );
  await render('service');
  expect(document.querySelector('.save-button')?.textContent).toContain('Settings saved');
  expect(document.querySelector('[aria-label="Connection test"]')?.textContent).toBe(
    'Not tested this session',
  );
  await click('.test-button');
  expect(document.querySelector('[aria-label="Connection test"]')?.textContent).toBe('Testing…');
  await act(async () => finish());
  expect(document.querySelector('[aria-label="Connection test"]')?.textContent).toBe('Test passed');
  await navigate('General');
  await click('[aria-label="Enable subtitles"]');
  await click('.save-button');
  await navigate('Translation service');
  expect(document.querySelector('[aria-label="Connection test"]')?.textContent).toBe('Test passed');
  vi.mocked(apiAction).mockRejectedValueOnce(new Error('Provider unavailable'));
  await click('.test-button');
  await advance(5000);
  await advance(180);
  expect(document.querySelector('.settings-alert')).toBeNull();
  expect(document.querySelector('[aria-label="Connection test"]')?.textContent).toBe('Test failed');
  expect(document.querySelector('.save-button')?.textContent).toContain('Settings saved');
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('#base-url')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'https://other.example/v1',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelector('[aria-label="Connection test"]')?.textContent).toBe(
    'Not tested this session',
  );
});
