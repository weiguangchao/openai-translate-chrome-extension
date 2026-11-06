import { expectTypeOf, it } from 'vitest';
import type { SourceCache } from '../src/core/bridge/source-cache';
import type { TimedCaption } from '../src/core/timeline';
import type { CaptionFrame } from '../src/core/translator';
import type { PlaybackCue } from '../src/shared/playback-plan';

type CachedSource = NonNullable<SourceCache['state']['source']>;
type CaptionFields = Pick<TimedCaption, keyof TimedCaption>;

it('requires caption text and cue timing', () => {
  expectTypeOf<CaptionFrame['text']>().toEqualTypeOf<string>();
  expectTypeOf<Pick<PlaybackCue, 'start' | 'end'>>().toEqualTypeOf<{
    readonly start: number;
    readonly end: number;
  }>();
});

it('keeps captions and cached cues read-only outside their owner', () => {
  expectTypeOf<PlaybackCue>().toEqualTypeOf<Readonly<PlaybackCue>>();
  expectTypeOf<CaptionFields>().toEqualTypeOf<Readonly<CaptionFields>>();
  expectTypeOf<Pick<SourceCache, 'state' | 'revision'>>().toEqualTypeOf<
    Readonly<Pick<SourceCache, 'state' | 'revision'>>
  >();
  expectTypeOf<CachedSource>().toEqualTypeOf<Readonly<CachedSource>>();
  expectTypeOf<CachedSource[number]>().toEqualTypeOf<Readonly<CachedSource[number]>>();
});
