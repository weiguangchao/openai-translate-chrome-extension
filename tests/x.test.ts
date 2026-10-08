import type { PrefetchItem } from '../src/shared/caption-translation';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/core/controller';
import { TranslationQueue } from '../src/extension/queue';
import { parseXSubtitlePlaylist, xMediaUrl } from '../src/platforms/x/captions';
import { createXPlatform } from '../src/platforms/x/platform';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';

const media = 'https://video.twimg.com/amplify_video/100';
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test', model: 'model' };

interface Track {
  name: string;
  lang: string;
  url: string;
}
interface Hls {
  url: string;
  media: HTMLVideoElement;
  subtitleTracks: Track[];
  subtitleTrack: number;
}
interface Rect {
  top: number;
  bottom: number;
}

let controller: CaptionController | undefined;
let queue: TranslationQueue;
let testTime = Date.now();
const requested: { at: number; texts: string[]; signal: AbortSignal }[] = [];

function track(id: string, lang: string): Track {
  return { name: `captions.${lang}.srt`, lang, url: `${media}/${id}/pl/s0/${lang}.m3u8` };
}

function stamp(seconds: number): string {
  return `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
}

function vtt(part: number, label: string): string {
  const cues = Array.from({ length: 10 }, (_, index) => (part - 1) * 10 + index + 1);
  if (part > 1) cues.unshift((part - 1) * 10);
  return `WEBVTT\n\n${cues
    .map((cue) => {
      const time = cue * 3;
      return `${stamp(time)} --> ${stamp(time + 2)}\n${label} ${cue}\n`;
    })
    .join('\n')}`;
}

function playlist(id: string, lang: string): string {
  return `#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:30\n#EXT-X-MEDIA-SEQUENCE:0\n${[
    1, 2, 3,
  ]
    .map(
      (part) => `#EXTINF:30.000,\n/subtitles/amplify_video/100/${id}/${lang}/${part}-segment.vtt`,
    )
    .join('\n')}\n#EXT-X-ENDLIST\n`;
}

function addPlayer(id: string, rect: Rect, paused: boolean, tracks = [track(id, 'EN')]) {
  const player = document.createElement('div');
  player.dataset.testid = 'videoPlayer';
  player.innerHTML = '<div data-testid="videoComponent"><div><video></video></div></div>';
  document.body.append(player);
  const video = player.querySelector('video')!;
  Object.defineProperties(video, {
    readyState: { value: 1 },
    paused: { value: paused, configurable: true },
    textTracks: { value: [], configurable: true },
    currentSrc: { value: `blob:https://x.com/${id}`, configurable: true },
  });
  const box = { left: 0, right: 640, ...rect };
  video.getBoundingClientRect = () =>
    ({ ...box, x: box.left, y: box.top, width: 640, height: box.bottom - box.top }) as DOMRect;
  const hls: Hls = {
    url: `${media}/${id}/pl/master.m3u8?tag=14`,
    media: video,
    subtitleTracks: tracks,
    subtitleTrack: 0,
  };
  Object.assign(video.parentElement!, {
    __reactFiber$test: {
      return: { return: { memoizedProps: { value: { playerApi: { video: { hlsJs: hls } } } } } },
    },
  });
  return {
    player,
    video,
    hls,
    move(next: Rect) {
      Object.assign(box, next);
    },
  };
}

const lines = () =>
  document
    .querySelector('[data-subline-overlay]')
    ?.shadowRoot?.querySelectorAll<HTMLElement>('.line');

const downloads = (pattern: RegExp) =>
  vi
    .mocked(fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => pattern.test(url));

async function playTo(video: HTMLVideoElement, time: number): Promise<void> {
  while (video.currentTime < time) {
    video.currentTime = Math.min(time, video.currentTime + 1);
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(1000);
  }
}

beforeEach(async () => {
  testTime += 600000;
  vi.useFakeTimers({ now: testTime });
  requested.length = 0;
  history.replaceState(null, '', '/NASA/status/1');
  document.body.innerHTML = '';
  vi.spyOn(window, 'postMessage').mockImplementation((data) => {
    const copy = structuredClone(data);
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent('message', { source: window, origin: location.origin, data: copy }),
      ),
    );
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const subtitle = path.match(/\/pl\/s0\/(\w+)\.m3u8$/);
      if (subtitle) return new Response(playlist(path.split('/')[3], subtitle[1]));
      const file = path.match(/\/(\w+)\/(\w+)\/(\d)-segment\.vtt$/);
      if (file) return new Response(vtt(Number(file[3]), file[2] === 'EN' ? 'Cue' : '字幕'));
      const texts = requestedTexts(init);
      requested.push({ at: 0, texts, signal: init.signal! });
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(providerReply(texts, (text) => `译文 ${text}`)),
          2000,
        );
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }),
  );
  queue = new TranslationQueue();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      sendMessage: async (message: {
        type: string;
        text: string;
        items: readonly PrefetchItem[];
        cacheOnly?: boolean;
      }) => {
        if (message.type === 'prefetch-pause') queue.pause('x');
        if (message.type === 'prefetch-resume') queue.resume('x');
        if (message.type === 'prefetch')
          return { ok: true, data: await queue.prefetch('x', settings, message.items) };
        if (message.type === 'translate')
          return {
            ok: true,
            data: await (message.cacheOnly
              ? queue.lookup(settings, message.text)
              : queue.request('x', settings, message.text)),
          };
        return { ok: true };
      },
    },
  });
  await import('../src/platforms/x/page');
});

afterEach(async () => {
  controller?.destroy();
  controller = undefined;
  queue.reset();
  window.dispatchEvent(new Event('pagehide'));
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'fullscreenElement');
});

it('prefetches four batches from the selected HLS subtitle playlist before any cue is shown', async () => {
  const { player, video } = addPlayer('a', { top: 0, bottom: 360 }, false);
  controller = new CaptionController(createXPlatform, publicSettings(settings));
  await vi.advanceTimersByTimeAsync(0);
  expect(downloads(/\.m3u8/)).toEqual([`${media}/a/pl/s0/EN.m3u8`]);
  expect(downloads(/\.vtt/)).toEqual(
    [1, 2, 3].map(
      (part) =>
        `${media.replace('/amplify_video', '/subtitles/amplify_video')}/a/EN/${part}-segment.vtt`,
    ),
  );
  const batch = (from: number) =>
    Array.from({ length: Math.min(4, 31 - from) }, (_, index) => `Cue ${from + index}`);
  const batches = [1, 5, 9, 13, 17, 21, 25, 29].map((from) => batch(from));
  expect(requested.map((request) => request.texts)).toEqual(batches.slice(0, 3));
  await vi.advanceTimersByTimeAsync(1000);
  expect(requested.map((request) => request.texts)).toEqual(batches.slice(0, 4));
  expect(player.querySelectorAll('[data-subline-overlay]')).toHaveLength(1);
  await playTo(video, 3);
  expect(lines()?.[0].textContent).toBe('Cue 1');
  expect(lines()?.[1].textContent).toBe('译文 Cue 1');
  expect(video.classList.contains('subline-native')).toBe(true);
  await playTo(video, 33);
  expect(lines()?.[1].textContent).toBe('译文 Cue 11');
  expect(requested.map((request) => request.texts)).toEqual(batches.slice(0, 6));
});

it('stops prefetch and clears the overlay when X captions are turned off', async () => {
  const { video, hls } = addPlayer('a', { top: 0, bottom: 360 }, false);
  controller = new CaptionController(createXPlatform, publicSettings(settings));
  await playTo(video, 19);
  expect(lines()?.[1].textContent).toBe('译文 Cue 6');
  hls.subtitleTrack = -1;
  await vi.advanceTimersByTimeAsync(1200);
  expect(lines()?.[0].hidden).toBe(true);
  expect(lines()?.[1].hidden).toBe(true);
  const count = requested.length;
  await playTo(video, 33);
  expect(requested).toHaveLength(count);
  hls.subtitleTrack = 0;
  await vi.advanceTimersByTimeAsync(1200);
  expect(lines()?.[0].textContent).toBe('Cue 11');
  expect(lines()?.[1].textContent).toBe('译文 Cue 11');
});

it('reads the source-language track when X shows another language and never downloads it', async () => {
  const { video, hls } = addPlayer('a', { top: 0, bottom: 360 }, false, [
    track('a', 'zh-Hans'),
    track('a', 'EN'),
  ]);
  controller = new CaptionController(createXPlatform, publicSettings(settings));
  await playTo(video, 3);
  expect(lines()?.[1].textContent).toBe('译文 Cue 1');
  expect(downloads(/zh-Hans/)).toEqual([]);
  hls.subtitleTracks = [track('a', 'zh-Hans')];
  await vi.advanceTimersByTimeAsync(1200);
  expect(lines()?.[0].hidden).toBe(true);
  expect(downloads(/zh-Hans/)).toEqual([]);
});

it('follows the playing, most visible video and moves the overlay when another one takes over', async () => {
  const first = addPlayer('a', { top: -200, bottom: 160 }, true);
  const second = addPlayer('b', { top: 200, bottom: 560 }, false);
  controller = new CaptionController(createXPlatform, publicSettings(settings));
  await playTo(second.video, 3);
  expect(second.player.querySelector('[data-subline-overlay]')).not.toBeNull();
  expect(first.player.querySelector('[data-subline-overlay]')).toBeNull();
  expect(lines()?.[1].textContent).toBe('译文 Cue 1');
  expect(downloads(/\/a\//)).toEqual([]);
  Object.defineProperty(second.video, 'paused', { value: true });
  second.move({ top: 900, bottom: 1260 });
  first.move({ top: 0, bottom: 360 });
  Object.defineProperty(first.video, 'paused', { value: false });
  await playTo(first.video, 4);
  expect(first.player.querySelector('[data-subline-overlay]')).not.toBeNull();
  expect(second.player.querySelector('[data-subline-overlay]')).toBeNull();
  expect(downloads(/\.m3u8/)).toEqual([`${media}/b/pl/s0/EN.m3u8`, `${media}/a/pl/s0/EN.m3u8`]);
  expect(lines()?.[0].textContent).toBe('Cue 1');
  expect(lines()?.[1].textContent).toBe('译文 Cue 1');
});

it('keeps the videos inside a fullscreen player and ignores ended ones', async () => {
  const outside = addPlayer('a', { top: 0, bottom: 360 }, false);
  const inside = addPlayer('b', { top: 0, bottom: 360 }, true);
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: inside.player,
  });
  controller = new CaptionController(createXPlatform, publicSettings(settings));
  await vi.advanceTimersByTimeAsync(0);
  expect(inside.player.querySelector('[data-subline-overlay]')).not.toBeNull();
  Reflect.deleteProperty(document, 'fullscreenElement');
  Object.defineProperty(outside.video, 'ended', { value: true });
  await vi.advanceTimersByTimeAsync(300);
  expect(inside.player.querySelector('[data-subline-overlay]')).not.toBeNull();
  expect(outside.player.querySelector('[data-subline-overlay]')).toBeNull();
});

it('aborts subtitle downloads when the video changes or the X toggle is turned off', async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        ),
      );
    }),
  );
  const { video, hls } = addPlayer('a', { top: 0, bottom: 360 }, false);
  controller = new CaptionController(createXPlatform, publicSettings(settings));
  await vi.advanceTimersByTimeAsync(0);
  expect(signals).toHaveLength(1);
  Object.defineProperty(video, 'currentSrc', { value: 'blob:https://x.com/next' });
  hls.url = `${media}/next/pl/master.m3u8`;
  hls.subtitleTracks = [track('next', 'EN')];
  await vi.advanceTimersByTimeAsync(1200);
  expect(signals[0].aborted).toBe(true);
  expect(signals).toHaveLength(2);
  controller.update({ ...publicSettings(settings), x: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(signals[1].aborted).toBe(true);
  expect(lines()).toBeUndefined();
});

it('translates live hls.js cues in the source language when the X player adapter is unavailable', async () => {
  const { video } = addPlayer('a', { top: 0, bottom: 360 }, false);
  Reflect.deleteProperty(video.parentElement!, '__reactFiber$test');
  const cue = { text: 'Live cue' };
  Object.defineProperty(video, 'textTracks', {
    value: [
      { kind: 'captions', language: '', mode: 'showing', activeCues: [cue] },
      { kind: 'subtitles', language: 'zh-Hans', mode: 'hidden', activeCues: [{ text: '中文' }] },
      { kind: 'subtitles', language: 'EN', mode: 'hidden', activeCues: [cue] },
    ],
  });
  controller = new CaptionController(createXPlatform, publicSettings(settings));
  await vi.advanceTimersByTimeAsync(3000);
  expect(requested.map((request) => request.texts)).toEqual([['Live cue']]);
  expect(lines()?.[0].textContent).toBe('Live cue');
  expect(lines()?.[1].textContent).toBe('译文 Live cue');
  expect(video.classList.contains('subline-native')).toBe(true);
  expect(downloads(/\.m3u8|\.vtt/)).toEqual([]);
});

it('accepts only X video CDN URLs and finished subtitle playlists', () => {
  expect(xMediaUrl('/subtitles/a.vtt', `${media}/pl/s0/a.m3u8`)).toBe(
    'https://video.twimg.com/subtitles/a.vtt',
  );
  for (const url of [
    'http://video.twimg.com/a.m3u8',
    'https://video.twimg.com.evil.example/a.m3u8',
    'https://pbs.twimg.com/a.m3u8',
    'https://user:password@video.twimg.com/a.m3u8',
    'not a url',
  ])
    expect(xMediaUrl(url)).toBeUndefined();
  const url = `${media}/a/pl/s0/EN.m3u8`;
  expect(
    parseXSubtitlePlaylist(`\uFEFF${playlist('a', 'EN').replaceAll('\n', '\r\n')}`, url),
  ).toEqual(
    [1, 2, 3].map(
      (part) => `https://video.twimg.com/subtitles/amplify_video/100/a/EN/${part}-segment.vtt`,
    ),
  );
  expect(
    parseXSubtitlePlaylist(
      '#EXTM3U\n#EXTINF:30,\nrelative.vtt\n#EXTINF:30,\nhttps://untrusted.example/b.vtt\n#EXT-X-ENDLIST',
      url,
    ),
  ).toEqual([`${media}/a/pl/s0/relative.vtt`]);
  expect(parseXSubtitlePlaylist(playlist('a', 'EN').replace('#EXT-X-ENDLIST', ''), url)).toEqual(
    [],
  );
  expect(parseXSubtitlePlaylist('WEBVTT\n\n00:00.000 --> 00:01.000\nHi', url)).toEqual([]);
  expect(
    parseXSubtitlePlaylist(`#EXTM3U\n${'#EXTINF:1,\na.vtt\n'.repeat(257)}#EXT-X-ENDLIST`, url),
  ).toEqual([]);
});
