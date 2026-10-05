import { expect, it } from 'vitest';
import {
  readCaptionTranslation,
  readStoredTranslation,
  subtitleUnits,
  translationInput,
} from '../src/shared/caption-translation';
import { captionWindow, timedCaptions, translatedCaptions } from '../src/core/timeline';
import {
  scanTranslationResults,
  subtitleDisplayLength,
  subtitleDisplayLimit,
} from '../src/shared/subtitle-segmentation';

const text =
  'The most budget option by far is to talk to your friends and family and find somebody with an old laptop or desktop that they will give you for free.';
const input = translationInput(text, true);
const sources = [
  'The most budget option by far is to talk to your friends and family',
  'and find somebody with an old laptop or desktop that they will give you for free.',
];
const parts = [
  { source: sources[0], translation: '最省钱的办法就是问问你的亲朋好友，' },
  { source: sources[1], translation: '找个愿意免费送你旧电脑的人。' },
];
const whole = '最省钱的办法就是问问你的亲朋好友，找个愿意免费送你旧电脑的人。';

it.each([
  'Hello, world! Again.',
  '他说：“你好，世界！”然后离开。',
  '“A cafe\u0301” costs €3.50 — really?',
  '👨‍👩‍👧‍👦 hello 🌍 goodbye!',
])('retains every non-whitespace character and valid Unicode boundaries in %s', (source) => {
  const units = subtitleUnits(source);
  expect(
    units
      .map((unit) => source.slice(unit.from, unit.to))
      .join('')
      .replace(/\s/g, ''),
  ).toBe(source.replace(/\s/g, ''));
  expect(
    units.every(
      (unit, index) => unit.to > unit.from && (!index || unit.from >= units[index - 1].to),
    ),
  ).toBe(true);
});

it('maps quoted sources onto the original text and ignores case, punctuation, quotes and accents', () => {
  const expected = {
    parts: [
      { from: 0, to: text.indexOf(' and find'), translation: parts[0].translation },
      { from: text.indexOf('and find'), to: text.length, translation: parts[1].translation },
    ],
  };
  expect(readCaptionTranslation(input, { parts })).toEqual(expected);
  expect(
    readCaptionTranslation(input, {
      parts: [
        {
          source: 'the most budget option, by far, is to talk to your friends and family —',
          text: parts[0].translation,
        },
        {
          source:
            '"And find somebody with an old laptop or desktop that they will give you for free"',
          translation: parts[1].translation,
        },
      ],
    }),
  ).toEqual(expected);
  const accented =
    'Le café coûte trois euros, et le thé coûte deux euros quand on le commande au comptoir.';
  const split = readCaptionTranslation(translationInput(accented, true), {
    parts: [
      { source: 'Le cafe\u0301 coute trois euros,', translation: '咖啡三欧元，' },
      {
        source: 'et le the coute deux euros quand on le commande au comptoir.',
        translation: '在柜台点茶两欧元。',
      },
    ],
  });
  if (!split || typeof split === 'string') throw new Error('Expected split result');
  expect(split.parts.map((part) => accented.slice(part.from, part.to))).toEqual([
    'Le café coûte trois euros,',
    'et le thé coûte deux euros quand on le commande au comptoir.',
  ]);
});

const lyrics =
  '[upbeat music] ♪ Rolling down the river road ♪ ♪ Under skies of silver gray ♪ ♪ We will sing until it’s done ♪♪ (Anna) "Are you coming with us?"';
const verses = [
  '[upbeat music] ♪ Rolling down the river road ♪',
  '♪ Under skies of silver gray ♪ ♪ We will sing until it’s done ♪♪',
  '(Anna) "Are you coming with us?"',
];
function displayedSources(source: string, quoted: readonly string[]): string[] {
  const result = readCaptionTranslation(translationInput(source, true), {
    parts: quoted.map((part, index) => ({ source: part, translation: `第${index}段` })),
  });
  if (!result || typeof result === 'string') throw new Error('Expected split result');
  return result.parts.map((part) => source.slice(part.from, part.to));
}

it('keeps punctuation between parts on the side where the Provider quoted it', () => {
  expect(displayedSources(lyrics, verses)).toEqual(verses);
  const quote = [
    '他站在车站等了很久很久，一直没有跟任何人说过一句话，最后他终于开口说：',
    '“这趟火车到底还会不会回来呢？”然后转身离开了。',
  ];
  expect(displayedSources(quote.join(''), quote)).toEqual(quote);
});

it('starts a part at an opening bracket or quote the Provider left out', () => {
  const source =
    'He waited for hours at the station without saying a word to anyone, (Ross) “Is the train ever coming back?”';
  expect(
    displayedSources(source, [
      'He waited for hours at the station without saying a word to anyone',
      'Ross Is the train ever coming back',
    ]),
  ).toEqual([
    'He waited for hours at the station without saying a word to anyone,',
    '(Ross) “Is the train ever coming back?”',
  ]);
  const plain =
    'We waited at the station for hours and then finally we left. "Wait for me," she said as she ran after us.';
  expect(
    displayedSources(plain, [
      'We waited at the station for hours and then finally we left',
      'Wait for me',
      'she said as she ran after us',
    ]),
  ).toEqual([
    'We waited at the station for hours and then finally we left.',
    '"Wait for me,"',
    'she said as she ran after us.',
  ]);
});

it('joins every part of a caption that does not need a split into one translation', () => {
  const short = translationInput('Short.', false);
  expect(translationInput(text, false).needsSplit).toBe(false);
  expect(translationInput('Short.', true).needsSplit).toBe(false);
  expect(readCaptionTranslation(short, { parts: [{ translation: ' 短句。 ' }] })).toBe('短句。');
  expect(readCaptionTranslation(short, { parts })).toBe(whole);
  expect(
    readCaptionTranslation(short, { parts: [{ translation: '你好' }, { translation: '世界' }] }),
  ).toBe('你好世界');
  expect(
    readCaptionTranslation(short, {
      parts: [{ translation: 'Hello,' }, { translation: 'world.' }],
    }),
  ).toBe('Hello, world.');
  expect(
    readCaptionTranslation(short, { parts: [{ translation: '他说：' }, { translation: 'OK.' }] }),
  ).toBe('他说：OK.');
});

it.each(
  [
    ['one part', [{ source: text, translation: whole }]],
    ['a part without a quoted source', [parts[0], { translation: parts[1].translation }]],
    [
      'a dropped filler word',
      [{ ...parts[0], source: sources[0].replace('by far ', '') }, parts[1]],
    ],
    [
      'a break inside a word',
      [
        { ...parts[0], source: `${sources[0]} an` },
        { ...parts[1], source: sources[1].slice(4) },
      ],
    ],
    [
      'an empty quoted source',
      [
        { ...parts[0], source: text },
        { ...parts[1], source: '' },
      ],
    ],
    ['a part too wide to show', [parts[0], { ...parts[1], translation: '字'.repeat(200) }]],
  ].map(([label, invalid]) => ({ label, invalid })),
)('shows the whole sentence when a split has $label', ({ invalid }) => {
  const result = readCaptionTranslation(input, { parts: invalid });
  expect(typeof result).toBe('string');
  expect(result).toBe(
    (invalid as { translation: string }[]).map((part) => part.translation).join(''),
  );
});

it.each(
  [
    ['no parts', []],
    ['an empty translation', [parts[0], { ...parts[1], translation: ' ' }]],
    ['a missing part', [parts[0]]],
    ['extra content', [parts[0], { ...parts[1], source: `${sources[1]} ${sources[0]}` }]],
    [
      'a translation longer than any caption',
      [parts[0], { ...parts[1], translation: '字'.repeat(5001) }],
    ],
  ].map(([label, invalid]) => ({ label, invalid })),
)('treats a split with $label as unusable', ({ invalid }) => {
  expect(readCaptionTranslation(input, { parts: invalid })).toBeNull();
});

it('accepts a complete split whose clauses run past two lines', () => {
  const clause = `${'word '.repeat(50).trim()} `;
  const source = `${clause}${clause.trim()}`;
  const units = subtitleUnits(source);
  const mid = subtitleUnits(clause).length;
  const first = source.slice(units[0].from, units[mid - 1].to);
  expect(subtitleDisplayLength(first)).toBeGreaterThan(subtitleDisplayLimit * 1.5);
  expect(subtitleDisplayLength(first)).toBeLessThanOrEqual(subtitleDisplayLimit * 4);
  expect(
    readCaptionTranslation(translationInput(source, true), {
      parts: [
        { source: clause, translation: '前半句。' },
        { source: clause, translation: '后半句。' },
      ],
    }),
  ).toEqual({
    parts: [
      { from: units[0].from, to: units[mid - 1].to, translation: '前半句。' },
      { from: units[mid].from, to: units.at(-1)!.to, translation: '后半句。' },
    ],
  });
});

it('shows a large multi-word source block or an indivisible word as a whole sentence', () => {
  const huge = 'word '.repeat(100).trim();
  expect(
    readCaptionTranslation(translationInput(huge, true), {
      parts: [
        { source: 'word', translation: '词' },
        { source: 'word '.repeat(99).trim(), translation: '长句' },
      ],
    }),
  ).toBe('词长句');
  const word = 'x'.repeat(150);
  expect(
    readCaptionTranslation(translationInput(word, true), {
      parts: [{ source: word, translation: word }],
    }),
  ).toBe(word);
});

it('waits for a whole result object in a fragmented stream, including escaped braces and quotes', () => {
  const first = { id: 1, parts: [{ translation: '他说："{你好}"' }] };
  const head = '```json\n{"note":[],"results":[' + JSON.stringify(first);
  expect(scanTranslationResults(head.slice(0, -1))).toEqual([]);
  expect(scanTranslationResults(head + ',{"id":0,"parts":[')).toEqual([first]);
});

it('reduces a complete but malformed result object to its id and keeps reading', () => {
  const ok = { id: 1, parts: [{ translation: '好' }] };
  expect(
    scanTranslationResults(
      `{"results":[{"id":0,"parts":[{"translation":"坏"} stray]},${JSON.stringify(ok)},{"parts":[} ]}]}`,
    ),
  ).toEqual([{ id: 0 }, ok]);
});

it('flags whole long sentences for a Provider split and excludes overlapping cues', () => {
  const captions = timedCaptions([
    { text: 'Before, ' + text, startTime: 0, endTime: 10 },
    { text, startTime: 11, endTime: 20 },
    { text: 'Overlap.', startTime: 15, endTime: 21 },
  ]);
  expect(captions.map((caption) => [caption.text, caption.needsSplit])).toEqual([
    ['Before, ' + text, true],
    [text, false],
    ['Overlap.', false],
  ]);
  expect(captionWindow(captions, 0).items.map((item) => item.needsSplit)).toEqual([
    true,
    false,
    false,
    false,
  ]);
});

it('times Provider parts from retained word timings and estimates untimed boundaries', () => {
  const source = 'Before, ' + text;
  const boundary = source.indexOf('and find');
  const cue = {
    text: source,
    startTime: 2,
    endTime: 20,
    timing: [
      { from: 0, to: 7, startTime: 2, endTime: 3 },
      { from: 8, to: boundary - 1, startTime: 3, endTime: 11 },
      { from: boundary, to: source.length, startTime: 11, endTime: 20 },
    ],
  };
  const [parent] = timedCaptions([cue]);
  const timed = readCaptionTranslation(translationInput(source, true), {
    parts: [{ source: 'Before,', translation: '之前，' }, ...parts],
  });
  if (!timed || typeof timed === 'string') throw new Error('Expected split result');
  const captions = translatedCaptions(parent, timed.parts);
  expect(captions.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
    [2, 3],
    [3, 11],
    [11, 20],
  ]);
  expect(captions.map((caption) => caption.text).join(' ')).toBe(source);
  const result = readCaptionTranslation(input, { parts });
  if (!result || typeof result === 'string') throw new Error('Expected split result');
  const estimated = translatedCaptions({ text, startTime: 0, endTime: 10 }, result.parts);
  expect(estimated[1].startTime).toBeCloseTo((10 * text.indexOf('and find')) / text.length);
  expect(estimated[0].endTime).toBe(estimated[1].startTime);
});

it('preserves display parts when invalid word timings require proportional timing', () => {
  const result = readCaptionTranslation(input, { parts });
  if (!result || typeof result === 'string') throw new Error('Expected split result');
  const cue = { text, startTime: 0, endTime: 10 };
  const captions = translatedCaptions(
    { ...cue, timing: [{ from: 0, to: text.length, startTime: 0, endTime: 0 }] },
    result.parts,
  );
  expect(captions).toEqual(translatedCaptions(cue, result.parts));
  expect(captions).toHaveLength(2);
  expect(
    captions.every((caption) => caption.text !== text && caption.endTime > caption.startTime),
  ).toBe(true);
});

it('keeps segments based on input captions when one provider result has more than ten display parts', () => {
  const source = Array.from({ length: 12 }, (_, index) => `longword${index}`).join(' ');
  const captions = timedCaptions([
    { text: source, startTime: 0, endTime: 12 },
    ...Array.from({ length: 9 }, (_, index) => ({
      text: `Next ${index}.`,
      startTime: 12 + index,
      endTime: 13 + index,
    })),
  ]);
  const result = readCaptionTranslation(translationInput(source, true), {
    parts: Array.from({ length: 12 }, (_, index) => ({
      source: `longword${index}`,
      translation: `词${index}`,
    })),
  });
  if (!result || typeof result === 'string') throw new Error('Expected split result');
  const display = translatedCaptions(captions[0], result.parts);
  expect(display).toHaveLength(12);
  expect(display.every((part) => part.kind === 'display')).toBe(true);
  expect(captionWindow(captions, 0).items).toHaveLength(10);
  expect(captions.map((caption) => caption.segment)).toEqual(Array(10).fill(0));
});

it('revalidates serialized translations before constructing display captions', () => {
  const valid = readCaptionTranslation(input, { parts });
  expect(readStoredTranslation(input, JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  if (!valid || typeof valid === 'string') throw new Error('Expected split result');
  const first = valid.parts[0];
  const second = valid.parts[1];
  expect(readStoredTranslation(input, ' 整句译文 ')).toBe('整句译文');
  for (const invalid of [
    ' ',
    { parts: [first] },
    { parts: [first, { ...second, to: second.to - 1 }] },
    { parts: [{ ...first, from: first.from + 1 }, second] },
    { parts: [first, { ...second, from: first.to - 1 }] },
    { parts: [first, { ...second, translation: '字'.repeat(200) }] },
  ])
    expect(readStoredTranslation(input, invalid)).toBeNull();
  expect(readStoredTranslation(translationInput('Short.', false), ' 短句 ')).toBe('短句');
  expect(readStoredTranslation(translationInput('Short.', false), valid)).toBeNull();
});

it('revalidates boundaries inside punctuation and rejects a stored part without words', () => {
  const input = translationInput(lyrics, true);
  const valid = readCaptionTranslation(input, {
    parts: verses.map((source, index) => ({ source, translation: `第${index}段` })),
  });
  if (!valid || typeof valid === 'string') throw new Error('Expected split result');
  expect(readStoredTranslation(input, JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  const [first, second, third] = valid.parts;
  const under = lyrics.indexOf('Under');
  expect(
    readStoredTranslation(input, {
      parts: [{ ...first, to: under - 1 }, { ...second, from: under }, third],
    }),
  ).not.toBeNull();
  expect(
    readStoredTranslation(input, {
      parts: [first, { ...second, to: second.from + 1 }, { ...second, from: under }, third],
    }),
  ).toBeNull();
});
