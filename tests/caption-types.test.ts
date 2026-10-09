import ts from 'typescript';
import { expect, it } from 'vitest';

it('rejects contradictory caption states, unverified display parts, and writes outside source ownership', () => {
  const filePath = ts.sys.resolvePath('tests/caption-types.fixture.ts');
  const setup = `
import type { CaptionFrame } from '../src/core/translator';
import type { DisplayCaption, TimedCaption } from '../src/core/timeline';
import { timedCaptions, translatedCaptions } from '../src/core/timeline';
import type { TranslationPart } from '../src/shared/caption-translation';
import type { PlaybackCue } from '../src/shared/playback-plan';
import type { PrefetchRequest } from '../src/shared/messages';
import type { SourceCache } from '../src/core/bridge/source-cache';
declare const cue: TimedCaption & { needsSplit: true };
declare const display: DisplayCaption;
declare const part: TranslationPart;
declare const item: PlaybackCue;
declare const cache: SourceCache;
const ordinary: CaptionFrame = { kind: 'ordinary', text: 'DOM caption.', time: 0, cacheOnly: false, debounce: 0 };
const split: CaptionFrame = { kind: 'split', cue, time: 0, cacheOnly: false, debounce: 0 };
const request: PrefetchRequest = { type: 'prefetch', time: 0, rate: 1, cues: [{ text: item.text, start: 0, end: 1, needsSplit: item.needsSplit }] };
translatedCaptions(cue, [part]);
`;
  const invalid = [
    `const missingCue: CaptionFrame = { kind: 'split', time: 0, cacheOnly: false, debounce: 0 };`,
    `const conflictingSource: CaptionFrame = { kind: 'split', cue, text: 'Different source.', time: 0, cacheOnly: false, debounce: 0 };`,
    `const parallelArrays: PrefetchRequest = { type: 'prefetch', texts: ['A'], segments: [0], needsSplit: [false] };`,
    `const missingTime: PlaybackCue = { text: 'A', needsSplit: false };`,
    `const oldGrouping: PlaybackCue = { text: 'A', start: 0, end: 1, needsSplit: false, batch: 0 };`,
    `item.start = 1;`,
    `cache.state = { mode: 'model', source: null };`,
    `cache.revision = 0;`,
    `cache.state.source?.push(cue);`,
    `if (cache.state.source) cache.state.source[0].text = 'Mutated';`,
    `if (cache.state.source?.[0].timing) cache.state.source[0].timing[0].to = 0;`,
    `translatedCaptions(cue, [{ from: 0, to: 1, translation: 'Unverified' }]);`,
    `timedCaptions([display]);`,
    `timedCaptions([cue]);`,
  ];
  const source = setup + invalid.join('\n');
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === filePath
      ? ts.createSourceFile(name, source, languageVersion, true)
      : read(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filePath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const firstInvalidLine = setup.split('\n').length - 1;
  expect(diagnostics.every((diagnostic) => diagnostic.file?.fileName === filePath)).toBe(true);
  expect(
    diagnostics
      .map((diagnostic) => diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line)
      .sort((a, b) => a - b),
  ).toEqual(invalid.map((_, index) => firstInvalidLine + index));
  expect(
    diagnostics.every((diagnostic) =>
      [2322, 2353, 2739, 2741, 2540, 2339].includes(diagnostic.code),
    ),
  ).toBe(true);
});
