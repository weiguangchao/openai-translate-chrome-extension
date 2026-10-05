import { expect, it } from 'vitest';
import {
  needsSubtitleSegmentation,
  subtitleDisplayLength,
  subtitleDisplayLimit,
} from '../src/shared/subtitle-segmentation';
import { githubCaption } from './fixtures/github-caption';

it('counts CJK characters and full-width punctuation as two columns and combining marks as none', () => {
  expect(subtitleDisplayLength('Hello, world.')).toBe(13);
  expect(subtitleDisplayLength('你好，世界')).toBe(10);
  expect(subtitleDisplayLength('cafe\u0301')).toBe(4);
});

it('flags only captions wider than the display limit for a Provider split', () => {
  expect(needsSubtitleSegmentation('a'.repeat(subtitleDisplayLimit))).toBe(false);
  expect(needsSubtitleSegmentation('a'.repeat(subtitleDisplayLimit + 1))).toBe(true);
  expect(needsSubtitleSegmentation('甲'.repeat(subtitleDisplayLimit / 2))).toBe(false);
  expect(needsSubtitleSegmentation('甲'.repeat(subtitleDisplayLimit / 2 + 1))).toBe(true);
  expect(needsSubtitleSegmentation(githubCaption)).toBe(true);
});
