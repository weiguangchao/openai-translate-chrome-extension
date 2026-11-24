import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['zh', 'zh-CN'],
  ['zh-CN', 'zh-CN'],
  ['zh-SG', 'zh-CN'],
  ['zh-TW', 'zh-TW'],
  ['zh-HK', 'zh-TW'],
  ['zh-Hant', 'zh-TW'],
  ['ZH-hant-TW', 'zh-TW'],
  ['en-US', 'en'],
  ['en-GB', 'en'],
  ['ja-JP', 'ja'],
  ['fr-FR', 'en'],
  ['ar', 'en'],
])('uses %s browser language to select %s UI text by default', async (language, expected) => {
  vi.stubGlobal('navigator', { language });
  const { uiLanguage } = await import('../src/shared/i18n');
  const { DEFAULT_SETTINGS } = await import('../src/shared/settings');
  expect(uiLanguage()).toBe(expected);
  expect(DEFAULT_SETTINGS.uiLanguage).toBe(expected);
});

it('keeps a saved interface language and rejects unsupported values', async () => {
  vi.stubGlobal('navigator', { language: 'en-US' });
  const { normalizeSettings } = await import('../src/shared/settings');
  expect(normalizeSettings({ uiLanguage: 'ja' }).uiLanguage).toBe('ja');
  expect(normalizeSettings({ uiLanguage: 'zh-TW' }).uiLanguage).toBe('zh-TW');
  expect(normalizeSettings({ uiLanguage: 'ko' }).uiLanguage).toBe('en');
});

it.each([
  {
    language: 'zh-CN',
    settingsText: ['常规设置', '正在读取设置…'],
    popupText: ['启用字幕', '简体中文'],
  },
  {
    language: 'zh-TW',
    settingsText: ['一般設定', '正在讀取設定…'],
    popupText: ['啟用字幕', '簡體中文'],
  },
  {
    language: 'en',
    settingsText: ['General', 'Loading settings…'],
    popupText: ['Enable subtitles', 'Simplified Chinese'],
  },
  {
    language: 'ja',
    settingsText: ['一般', '設定を読み込み中…'],
    popupText: ['字幕を有効にする', '簡体字中国語'],
  },
] as const)(
  'renders the settings page and popup in $language after switching the interface language',
  async ({ language, settingsText, popupText }) => {
    vi.stubGlobal('navigator', { language: 'fr-FR' });
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { App } = await import('../src/ui/App');
    const { Popup } = await import('../src/ui/Popup');
    const { setUiLanguage } = await import('../src/shared/i18n');
    renderToStaticMarkup(createElement(App));
    setUiLanguage(language);
    const settings = renderToStaticMarkup(createElement(App));
    const popup = renderToStaticMarkup(createElement(Popup));
    for (const text of settingsText) expect(settings).toContain(text);
    for (const text of popupText) expect(popup).toContain(text);
  },
);
