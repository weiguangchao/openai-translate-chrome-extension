import { simplifiedChinese, traditionalChinese } from './chinese';
import { english } from './english';
import type { LanguageSegmenter } from './lines';

export type { LanguageSegmenter, TextRange } from './lines';
export {
  needsSubtitleSegmentation,
  sentenceDisplayLimit,
  subtitleDisplayLength,
  subtitleDisplayLimit,
} from './width';

const segmenters = new Map<string, LanguageSegmenter>([
  ['en', english],
  ['zh-CN', simplifiedChinese],
  ['zh-TW', traditionalChinese],
]);

export function segmenterFor(language: string): LanguageSegmenter {
  return segmenters.get(language) ?? english;
}
