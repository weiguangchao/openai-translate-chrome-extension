import { supportedLanguage } from '../languages';
import { chinese, english, noop } from './echogarden';
import type { LanguageSegmenter } from './lines';

export type { LanguageSegmenter, TextRange } from './lines';
export { subtitleDisplayLength } from './width';

export function segmenterFor(language: string): LanguageSegmenter {
  switch (supportedLanguage(language)) {
    case 'en':
      return english;
    case 'zh-CN':
    case 'zh-TW':
      return chinese;
    default:
      return noop;
  }
}
