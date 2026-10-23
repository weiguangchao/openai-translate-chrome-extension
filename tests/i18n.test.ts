import { afterEach, expect, it, vi } from 'vitest';

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
  vi.resetModules();
  vi.stubGlobal('navigator', { language });
  const { uiLanguage } = await import('../src/shared/i18n');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { App } = await import('../src/ui/App');
  const { Popup } = await import('../src/ui/Popup');
  expect(uiLanguage).toBe(expected);
  const settings = renderToStaticMarkup(createElement(App));
  const popup = renderToStaticMarkup(createElement(Popup));
  expect(settings).toContain(expected === 'zh-CN' ? '常规设置' : 'General');
  expect(settings).toContain(expected === 'zh-CN' ? '测试连接' : 'Test connection');
  expect(popup).toContain(expected === 'zh-CN' ? '启用双语字幕' : 'Enable bilingual subtitles');
  expect(popup).toContain(expected === 'zh-CN' ? '简体中文' : 'Simplified Chinese');
});
