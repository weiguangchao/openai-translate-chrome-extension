import { supportedLanguage } from '../languages';
import { japanese, simplifiedChinese, traditionalChinese } from './cjk';
import { english } from './english';
import type { LanguageSegmenter } from './lines';

export type { LanguageSegmenter, TextRange } from './lines';
export { subtitleDisplayLength } from './width';

const segmenters = new Map<string, LanguageSegmenter>([
  ['en', english],
  ['zh-CN', simplifiedChinese],
  ['zh-TW', traditionalChinese],
  ['ja', japanese],
]);

export function segmenterFor(language: string): LanguageSegmenter {
  return segmenters.get(supportedLanguage(language) ?? language) ?? english;
}
