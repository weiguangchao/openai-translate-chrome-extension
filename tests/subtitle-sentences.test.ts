import { expect, it } from 'vitest';
import { authoredSubtitleCaptions } from '../src/core/sentences';
import { captionAt } from '../src/core/timeline';

it('splits multiline authored subtitles into timed sentences', () => {
  const text = "Oh, thank you.\nI've got to talk to that\nmailman.";
  const cues = authoredSubtitleCaptions([{ startTime: 3, endTime: 9, text }], 'en');
  expect(cues.map((cue) => cue.text)).toEqual([
    'Oh, thank you.',
    "I've got to talk to that mailman.",
  ]);
  expect(captionAt(cues, 3)).toBe('Oh, thank you.');
  expect(captionAt(cues, 6)).toBe("I've got to talk to that mailman.");
  expect(captionAt(cues, 9)).toBe('');
});

it('rejoins a fragmented sentence and cuts it into back-to-back captions at clause punctuation', () => {
  const first = 'When I first moved to the city I did not know anyone at all,';
  const second = 'and every night I walked along the river wondering why I had come.';
  const captions = authoredSubtitleCaptions(
    [
      { startTime: 1, endTime: 5, text: first },
      { startTime: 5.2, endTime: 9, text: second },
    ],
    'en',
  );
  expect(captions).toEqual([
    { startTime: 1, endTime: 5.2, text: first },
    { startTime: 5.2, endTime: 9, text: second },
  ]);
  expect(captionAt(captions, 5.1)).toBe(first);
  expect(captionAt(captions, 6)).toBe(second);
});

it('cuts an unpunctuated run between cues into captions of at most 90 columns', () => {
  const lines = [
    'my children will be using their Sama coins to try and buy dinner',
    "and I'll have to explain to them that when I was a kid",
    'we used to use US dollars in order to get our Sama coins',
    'and we used to pay two hundred dollars for twelve hundred',
    'I know I am memeing pretty hard here but seriously just a few weeks ago',
    'a plan on your codex sub would get you up to twelve thousand a month',
  ];
  const captions = authoredSubtitleCaptions(
    lines.map((text, index) => ({ startTime: index * 4, endTime: index * 4 + 3.8, text })),
    'en',
  );
  expect(captions.map((caption) => caption.text)).toEqual(lines);
  expect(captions.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
    [0, 4],
    [4, 8],
    [8, 12],
    [12, 16],
    [16, 20],
    [20, 23.8],
  ]);
});

it.each([
  [1.9, [{ startTime: 0, endTime: 5, text: 'We were waiting for the bus.' }]],
  [
    2,
    [
      { startTime: 0, endTime: 2, text: 'We were waiting' },
      { startTime: 4, endTime: 5, text: 'for the bus.' },
    ],
  ],
])('ends a sentence only when a silence reaches two seconds, gap=%s', (gap, expected) => {
  const captions = authoredSubtitleCaptions(
    [
      { startTime: 0, endTime: 2, text: 'We were waiting' },
      { startTime: 2 + gap, endTime: 5, text: 'for the bus.' },
    ],
    'en',
  );
  expect(captions).toEqual(expected);
});

it('keeps lyric lines and sound tags apart from the dialogue around them', () => {
  const captions = authoredSubtitleCaptions(
    [
      { startTime: 0, endTime: 1.5, text: '♪ So no one told you ♪' },
      { startTime: 1.55, endTime: 3, text: "♪ 'Cause you're\nthere for me too ♪♪" },
      { startTime: 3.05, endTime: 5, text: '(Chandler)\nSo, how does it feel' },
      { startTime: 5.1, endTime: 7, text: "knowing you're about to die?" },
      { startTime: 7.1, endTime: 8, text: '[laughs]' },
      { startTime: 8.05, endTime: 9, text: 'Okay' },
    ],
    'en',
  );
  expect(captions.map((caption) => caption.text)).toEqual([
    '♪ So no one told you ♪',
    "♪ 'Cause you're there for me too ♪♪",
    "(Chandler) So, how does it feel knowing you're about to die?",
    '[laughs]',
    'Okay',
  ]);
});

it.each([
  ['Wait.\nPlease.', 'Wait. Please.'],
  [
    'Years later, standing on the same bridge,\nI finally understood that the city had become my home.',
    'Years later, standing on the same bridge, I finally understood that the city had become my home.',
  ],
])(
  'preserves overlapping speech and repeated dialogue with their original timing',
  (text, expected) => {
    const cues = [
      { startTime: 1, endTime: 4, text },
      { startTime: 2, endTime: 3, text: 'No. Stop.' },
      { startTime: 2, endTime: 5, text },
      { startTime: 6, endTime: 8, text: 'Later. Goodbye.' },
    ];
    const captions = authoredSubtitleCaptions(cues, 'en');
    expect(captions.slice(0, 3)).toEqual([
      { startTime: 1, endTime: 4, text: expected },
      { startTime: 2, endTime: 3, text: 'No. Stop.' },
      { startTime: 2, endTime: 5, text: expected },
    ]);
    expect(captions.slice(3).map((caption) => caption.text)).toEqual(['Later.', 'Goodbye.']);
    expect(captionAt(captions, 2.5)).toBe(`${expected}\nNo. Stop.\n${expected}`);
  },
);

it('ends Chinese sentences at full-width punctuation across fragmented cues', () => {
  const cues = authoredSubtitleCaptions(
    [
      { startTime: 1, endTime: 3, text: '我昨天去了' },
      { startTime: 3, endTime: 5, text: '商店。你呢？' },
      { startTime: 5, endTime: 7, text: '「我在家。」' },
    ],
    'zh-TW',
  );
  expect(cues.map((cue) => cue.text)).toEqual(['我昨天去了商店。', '你呢？', '「我在家。」']);
  expect(cues[0]).toMatchObject({ startTime: 1 });
  expect(cues[2]).toMatchObject({ startTime: 5, endTime: 7 });
});
