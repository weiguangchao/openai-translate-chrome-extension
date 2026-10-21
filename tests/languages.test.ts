import { expect, it } from 'vitest';
import { supportedLanguage } from '../src/shared/languages';

it.each([
  ['en', 'en'],
  ['EN-us', 'en'],
  ['en_GB', 'en'],
  ['ja', 'ja'],
  ['ja-JP', 'ja'],
  ['zh', 'zh-CN'],
  ['zh-CN', 'zh-CN'],
  ['zh-SG', 'zh-CN'],
  ['zh-Hans', 'zh-CN'],
  ['zh-TW', 'zh-TW'],
  ['zh-HK', 'zh-TW'],
  ['zh-Hant', 'zh-TW'],
  ['zh-Hant-CN', 'zh-TW'],
  ['zh-Hans-TW', 'zh-CN'],
  ['', null],
  ['fr', null],
  ['ko', null],
  ['en-Cyrl', null],
  ['ja-Latn', null],
  ['zh-Latn', null],
  ['not a language', null],
])('maps caption language %j to %j', (input, expected) => {
  expect(supportedLanguage(input)).toBe(expected);
});
