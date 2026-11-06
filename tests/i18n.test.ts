import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['zh', 'zh-CN'],
  ['zh-CN', 'zh-CN'],
  ['zh-SG', 'zh-CN'],
  ['zh-TW', 'zh-CN'],
  ['zh-HK', 'zh-CN'],
  ['zh-Hant', 'zh-CN'],
  ['ZH-hant-TW', 'zh-CN'],
  ['en-US', 'en'],
  ['en-GB', 'en'],
  ['ja-JP', 'en'],
  ['fr-FR', 'en'],
  ['ar', 'en'],
])('uses %s browser language to select %s UI text', async (language, expected) => {
  vi.stubGlobal('navigator', { language });
  const { uiLanguage } = await import('../src/shared/i18n');
  expect(uiLanguage).toBe(expected);
});

it.each([
  {
    language: 'zh',
    settingsText: ['常规设置', '测试连接'],
    popupText: ['启用双语字幕', '简体中文'],
  },
  {
    language: 'en-US',
    settingsText: ['General', 'Test connection'],
    popupText: ['Enable bilingual subtitles', 'Simplified Chinese'],
  },
])(
  'renders the settings page and popup in the $language UI language',
  async ({ language, settingsText, popupText }) => {
    vi.stubGlobal('navigator', { language });
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { App } = await import('../src/ui/App');
    const { Popup } = await import('../src/ui/Popup');
    const settings = renderToStaticMarkup(createElement(App));
    const popup = renderToStaticMarkup(createElement(Popup));
    for (const text of settingsText) expect(settings).toContain(text);
    for (const text of popupText) expect(popup).toContain(text);
  },
);
