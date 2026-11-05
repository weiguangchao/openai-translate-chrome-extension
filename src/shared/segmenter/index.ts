import { supportedLanguage } from '../languages';
import { english, noop } from './echogarden';
import type { LanguageSegmenter } from './lines';

export type { LanguageSegmenter, TextRange } from './lines';
export { subtitleDisplayLength } from './width';

export function segmenterFor(language: string): LanguageSegmenter {
  return supportedLanguage(language) === 'en' ? english : noop;
}
