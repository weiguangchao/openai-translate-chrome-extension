import { expect, it } from 'vitest';
import { parseWebVtt } from '../src/core/webvtt';

it('parses identifiers, markup, entities and CRLF while skipping metadata and invalid times', () => {
  const text =
    'WEBVTT\n\nNOTE ignore\n00:00.000 --> 00:01.000\nComment\n\nSTYLE\n::cue { color: red }\n\ncue-id\n00:01.000 --> 00:03.000 align:start\n<v Narrator><i>Hello &amp; goodbye.</i></v>\nSecond line &lt;3\n\n00:04.000 --> 00:02.000\nInvalid\n\n00:60.000 --> 01:02.000\nInvalid\n';
  expect(parseWebVtt(`\uFEFF${text.replaceAll('\n', '\r\n')}`, 10)).toEqual([
    { startTime: 11, endTime: 13, text: 'Hello & goodbye.\nSecond line <3' },
  ]);
  expect(() => parseWebVtt('<html>Not subtitles</html>')).toThrow('Invalid WebVTT');
});
