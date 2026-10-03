import { expect, it } from 'vitest';
import {
  scanTranslationStrings,
  splitSubtitleAtCommas,
  subtitleDisplayLength,
  subtitleDisplayLimit,
} from '../src/shared/subtitle-segmentation';
import { githubCaption, githubCommaParts } from './fixtures/github-caption';

it('reads each closed translation without parsing a partial JSON document', () => {
  expect(scanTranslationStrings('{"translations":["第一')).toEqual({ values: [], closed: false });
  expect(scanTranslationStrings('{"translations":["第一句","第二')).toEqual({
    values: ['第一句'],
    closed: false,
  });
  expect(
    scanTranslationStrings('```json\n{"translations":["他说\\"你好\\"\\n中\\/\\u6587"]}\n```'),
  ).toEqual({ values: ['他说"你好"\n中/文'], closed: true });
  expect(scanTranslationStrings('["甲","乙"]')).toEqual({ values: ['甲', '乙'], closed: true });
  expect(scanTranslationStrings('{"note":"skip","translations":["甲"]}')).toEqual({
    values: ['甲'],
    closed: true,
  });
});

it('packs comma-separated clauses into as few parts as the display limit allows', () => {
  const clause = 'a'.repeat(40);
  const text = `${clause}, ${clause}, ${clause}`;
  expect(splitSubtitleAtCommas(text).map((part) => text.slice(part.from, part.to))).toEqual([
    `${clause}, ${clause},`,
    clause,
  ]);
  expect(subtitleDisplayLength(`${clause}, ${clause},`)).toBeLessThanOrEqual(subtitleDisplayLimit);
  expect(subtitleDisplayLength(text)).toBeGreaterThan(subtitleDisplayLimit);
});

it('cuts a long sentence once when one comma leaves both sides on screen', () => {
  const text =
    "I didn't realize how bad things were because I, like most people, thought a bicycle was probably a good idea, but just didn't bother.";
  expect(splitSubtitleAtCommas(text).map((part) => text.slice(part.from, part.to))).toEqual([
    "I didn't realize how bad things were because I, like most people,",
    "thought a bicycle was probably a good idea, but just didn't bother.",
  ]);
  for (const part of splitSubtitleAtCommas(text))
    expect(subtitleDisplayLength(text.slice(part.from, part.to))).toBeLessThanOrEqual(
      subtitleDisplayLimit,
    );
});

it('does not split a caption that already fits', () => {
  const text = 'Hello, world, again.';
  expect(splitSubtitleAtCommas(text)).toEqual([{ from: 0, to: text.length }]);
});

it('splits on a Chinese comma and keeps an overlong clause without one intact', () => {
  const head = '甲'.repeat(40);
  const tail = '乙'.repeat(20);
  const chinese = `${head}，${tail}`;
  expect(splitSubtitleAtCommas(chinese).map((part) => chinese.slice(part.from, part.to))).toEqual([
    `${head}，`,
    tail,
  ]);
  const unbroken = `${'a'.repeat(120)}, tail`;
  expect(splitSubtitleAtCommas(unbroken).map((part) => unbroken.slice(part.from, part.to))).toEqual(
    [`${'a'.repeat(120)},`, 'tail'],
  );
});

it('splits the sample caption only at the comma that keeps the first clause on screen', () => {
  expect(
    splitSubtitleAtCommas(githubCaption).map((part) => githubCaption.slice(part.from, part.to)),
  ).toEqual(githubCommaParts);
});
