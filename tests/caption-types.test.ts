import ts from 'typescript';
import { expect, it } from 'vitest';

it('rejects split caption states, per-word timings, and writes outside source ownership', () => {
  const filePath = ts.sys.resolvePath('tests/caption-types.fixture.ts');
  const setup = `
import type { CaptionFrame } from '../src/core/translator';
import type { TimedCaption } from '../src/core/timeline';
import { timedCaptions } from '../src/core/timeline';
import type { PlaybackCue } from '../src/shared/playback-plan';
import type { PrefetchRequest } from '../src/shared/messages';
import type { SourceCache } from '../src/core/bridge/source-cache';
declare const caption: TimedCaption;
declare const item: PlaybackCue;
declare const cache: SourceCache;
const frame: CaptionFrame = { text: 'DOM caption.', cacheOnly: false, debounce: 0 };
const request: PrefetchRequest = { type: 'prefetch', time: 0, rate: 1, cues: [{ text: item.text, start: 0, end: 1 }] };
timedCaptions([{ startTime: 0, endTime: 1, text: 'A' }]);
`;
  const invalid = [
    `const oldSplit: CaptionFrame = { kind: 'split', text: 'A', cacheOnly: false, debounce: 0 };`,
    `const missingText: CaptionFrame = { cacheOnly: false, debounce: 0 };`,
    `const parallelArrays: PrefetchRequest = { type: 'prefetch', texts: ['A'], segments: [0] };`,
    `const missingTime: PlaybackCue = { text: 'A' };`,
    `const oldSplitFlag: PlaybackCue = { text: 'A', start: 0, end: 1, needsSplit: false };`,
    `item.start = 1;`,
    `caption.segment = 1;`,
    `const timing = caption.timing;`,
    `cache.state = { mode: 'model', source: null };`,
    `cache.revision = 0;`,
    `cache.state.source?.push(caption);`,
    `if (cache.state.source) cache.state.source[0].text = 'Mutated';`,
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
