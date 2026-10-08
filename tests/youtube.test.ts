import type { PrefetchItem } from '../src/shared/caption-translation';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/core/controller';
import { createYoutubePlatform } from '../src/platforms/youtube/platform';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';
import { TranslationQueue } from '../src/extension/queue';
import { githubCaption, githubCaptionTrack, githubCommaParts } from './fixtures/github-caption';
import { providerReply, requestedTexts } from './fixtures/provider';
import type { CaptionTranslation } from '../src/shared/caption-translation';
import { structuredReply } from './fixtures/long-caption';

let controller: CaptionController | undefined;
let resourceEntries: (entries: PerformanceEntry[]) => void;
afterEach(() => {
  controller?.destroy();
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'fullscreenElement');
});

function setup() {
  vi.useFakeTimers();
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      constructor(callback: PerformanceObserverCallback) {
        resourceEntries = (entries) =>
          callback({ getEntries: () => entries } as PerformanceObserverEntryList, this as never);
      }
      observe() {}
    },
  );
  document.body.innerHTML =
    '<div class="html5-video-player"><video></video><button class="ytp-subtitles-button" aria-pressed="true"></button><div class="ytp-caption-window-container"></div></div>';
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'textTracks', { configurable: true, value: [] });
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  history.replaceState(null, '', '/watch?v=video-1');
  const player = document.querySelector('.html5-video-player')!;
  vi.spyOn(window, 'postMessage').mockImplementation((data) => {
    const message = structuredClone(data);
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          source: window,
          origin: location.origin,
        }),
      ),
    );
  });
  const sendMessage = vi.fn(
    (message: {
      type: string;
      text?: string;
      items?: readonly PrefetchItem[];
      cacheOnly?: boolean;
      needsSplit?: boolean;
    }): Promise<{ ok: boolean; data?: CaptionTranslation | null }> =>
      Promise.resolve(
        message.type === 'translate' ? { ok: true, data: `译文：${message.text}` } : { ok: true },
      ),
  );
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  const lines = () =>
    document
      .querySelector('[data-subline-overlay]')!
      .shadowRoot!.querySelectorAll<HTMLElement>('.line');
  return { video, player, sendMessage, lines };
}

async function playTo(video: HTMLVideoElement, time: number) {
  const direction = time >= video.currentTime ? 1 : -1;
  let at = video.currentTime;
  while (direction > 0 ? at + direction < time : at + direction > time) {
    at += direction;
    video.currentTime = at;
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(0);
  }
  video.currentTime = time;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(0);
}

it('prefetches a long subtitle whole, has the Provider split it, and shows each part on time after a seek', async () => {
  const { video, player, sendMessage, lines } = setup();
  Object.assign(player, {
    getOption: () => ({ vssId: 'a.en' }),
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video-1' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: 'en',
              kind: 'asr',
              vssId: 'a.en',
              baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en',
            },
          ],
        },
      },
    }),
  });
  let finish!: (value: Response) => void;
  const requests: string[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/timedtext')) return Response.json(githubCaptionTrack);
      requests.push(requestedTexts(init!));
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  const saved = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' };
  const queue = new TranslationQueue();
  sendMessage.mockImplementation(async (message) => {
    if (message.type === 'translate')
      return {
        ok: true,
        data: await (message.cacheOnly
          ? queue.lookup(saved, message.text!, message.needsSplit === true)
          : queue.request('video', saved, message.text!, message.needsSplit === true)),
      };
    if (message.type === 'prefetch') queue.prefetch('video', saved, message.items!);
    return { ok: true };
  });
  await import('../src/platforms/youtube/page');
  controller = new CaptionController(createYoutubePlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect([...lines()].map((line) => [line.hidden, line.textContent])).toEqual([
    [true, ''],
    [true, ''],
  ]);
  await vi.advanceTimersByTimeAsync(300);
  expect([...lines()].map((line) => [line.hidden, line.textContent])).toEqual([
    [true, ''],
    [false, '翻译中'],
  ]);
  expect(requests).toEqual([[githubCaption]]);
  const split = [
    githubCommaParts[0],
    'and many other people are realizing',
    'that GitHub might not be the safest place for us to be leaving our code',
    "now that they're randomly reverting merges and having downtime",
    'that is measured in days instead of minutes.',
  ];
  finish(
    structuredReply([
      { id: 0, parts: split.map((source) => ({ source, translation: `译文：${source}` })) },
    ]),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect([...lines()].map((line) => line.textContent)).toEqual([split[0], `译文：${split[0]}`]);
  video.currentTime = 6.75;
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(400);
  expect([...lines()].map((line) => line.textContent)).toEqual([split[3], `译文：${split[3]}`]);
  const snapshots: string[][] = [];
  for (const time of [0, 3, 8.25, 2]) {
    video.currentTime = time;
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(0);
    snapshots.push([...lines()].map((line) => line.textContent ?? ''));
  }
  expect(snapshots).toEqual([
    [split[0], `译文：${split[0]}`],
    [split[2], `译文：${split[2]}`],
    [split[3], `译文：${split[3]}`],
    [split[1], `译文：${split[1]}`],
  ]);
  expect(requests).toEqual([[githubCaption]]);
  video.currentTime = 11;
  video.dispatchEvent(new Event('timeupdate'));
  expect([...lines()].map((line) => line.hidden)).toEqual([true, true]);
  queue.reset();
});

it('translates and displays complete ASR sentences across rolling events', async () => {
  const { video, player, sendMessage, lines } = setup();
  Object.assign(player, {
    getOption: () => ({ vssId: 'a.en' }),
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video-1' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: 'en',
              kind: 'asr',
              vssId: 'a.en',
              baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en',
            },
          ],
        },
      },
    }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        events: [
          { tStartMs: 1000, dDurationMs: 4000, segs: [{ utf8: 'This field behind me' }] },
          { tStartMs: 2500, dDurationMs: 4000, segs: [{ utf8: 'will become a city.' }] },
          { tStartMs: 4500, dDurationMs: 3000, segs: [{ utf8: 'Let’s build it.' }] },
        ],
      }),
    ),
  );
  document.querySelector('.ytp-caption-window-container')!.innerHTML =
    '<span class="ytp-caption-segment">This field behind me</span>';
  await import('../src/platforms/youtube/page');
  controller = new CaptionController(
    createYoutubePlatform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'prefetch',
    items: [
      {
        text: 'This field behind me will become a city.',
        segment: 0,
        needsSplit: false,
        solo: true,
      },
      { text: 'Let’s build it.', segment: 0, needsSplit: false, solo: true },
    ],
  });
  await playTo(video, 1.2);
  expect([...lines()].map((line) => line.textContent)).toEqual([
    'This field behind me will become a city.',
    '译文：This field behind me will become a city.',
  ]);
  await playTo(video, 3);
  expect(lines()[0].textContent).toBe('This field behind me will become a city.');
  expect(
    sendMessage.mock.calls
      .filter(([message]) => message.type === 'translate')
      .map(([message]) => message.text),
  ).toEqual(['This field behind me will become a city.']);
  expect(getComputedStyle(document.querySelector('.ytp-caption-window-container')!).opacity).toBe(
    '0',
  );
  await playTo(video, 4.5);
  expect([...lines()].map((line) => line.textContent)).toEqual([
    'Let’s build it.',
    '译文：Let’s build it.',
  ]);
  controller.update({ ...publicSettings(DEFAULT_SETTINGS), enabled: false });
  expect(
    getComputedStyle(document.querySelector('.ytp-caption-window-container')!).opacity,
  ).not.toBe('0');
});

it('loads the selected YouTube track before playback, aligns rolling captions, and drops a late track response after navigation', async () => {
  const { video, player, sendMessage, lines } = setup();
  let videoId = 'video-1';
  let languageCode = 'en';
  Object.assign(player, {
    getOption: () => ({ languageCode, vssId: `.${languageCode}` }),
    getPlayerResponse: () => ({
      videoDetails: { videoId },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: ['en', 'es'].map((language) => ({
            languageCode: language,
            kind: 'asr',
            vssId: `.${language}`,
            baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${language}`,
          })),
        },
      },
    }),
  });
  let oldTrack!: (response: Response) => void;
  const fetch = vi.fn((url: string) => {
    if (url.includes('lang=es'))
      return new Promise<Response>((resolve) => {
        oldTrack = resolve;
      });
    return Promise.resolve(
      Response.json({
        events: [
          {
            tStartMs: 2000,
            dDurationMs: 4000,
            segs: [{ utf8: videoId === 'video-1' ? 'First phrase.' : 'New video.' }],
          },
          { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'Second phrase.' }] },
        ],
      }),
    );
  });
  fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  await import('../src/platforms/youtube/page');
  controller = new CaptionController(
    createYoutubePlatform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch.mock.calls[0][0]).toContain('fmt=json3');
  expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'translate' }));
  await vi.advanceTimersByTimeAsync(16000);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'prefetch',
    items: [
      { text: 'First phrase.', segment: 0, needsSplit: false },
      { text: 'Second phrase.', segment: 0, needsSplit: false },
    ],
  });
  expect(lines()[1].hidden).toBe(true);
  await playTo(video, 4);
  expect(lines()[0].textContent).toBe('Second phrase.');
  expect(lines()[1].textContent).toBe('译文：Second phrase.');
  languageCode = 'es';
  controller.update(
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model', sourceLanguage: 'es' }),
  );
  await vi.advanceTimersByTimeAsync(1100);
  expect(oldTrack).toBeTypeOf('function');
  expect(lines()[1].hidden).toBe(true);
  videoId = 'video-2';
  languageCode = 'en';
  controller.update(publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }));
  history.replaceState(null, '', '/watch?v=video-2');
  video.currentTime = 2;
  video.dispatchEvent(new Event('loadedmetadata'));
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()[1].textContent).toBe('译文：New video.');
  oldTrack(
    Response.json({
      events: [{ tStartMs: 0, dDurationMs: 10000, segs: [{ utf8: 'Stale track' }] }],
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()[1].textContent).toBe('译文：New video.');
  document.querySelector('button')!.setAttribute('aria-pressed', 'false');
  await vi.advanceTimersByTimeAsync(150);
  expect(lines()[1].hidden).toBe(true);
  expect(document.querySelector('[data-subline-timeline]')).toBeNull();
});

it('uses the current video session to load source subtitles and removes duplicate drawing layers', async () => {
  const { video, player, sendMessage, lines } = setup();
  let videoId = 'video-1';
  let session = 'session-1';
  let token = 'expired';
  Object.assign(player, {
    getOption: () => ({ languageCode: 'en', vssId: '.en' }),
    getPlayerResponse: () => ({
      videoDetails: { videoId },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: ['en', 'zh-Hans'].map((language) => ({
            languageCode: language,
            vssId: `.${language}`,
            baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&ei=${session}&lang=${language}&signature=signed-${language}`,
          })),
        },
      },
    }),
  });
  const request = (id: string, ei: string, pot: string, startedAt: number) =>
    resourceEntries([
      {
        name: `https://www.youtube.com/api/timedtext?v=${id}&ei=${ei}&lang=en&signature=signed-en&pot=${pot}&potc=1&c=WEB&cver=2&fmt=json3`,
        startTime: startedAt,
      } as PerformanceResourceTiming,
    ]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (value: string) => {
      const url = new URL(value);
      const language = url.searchParams.get('lang');
      if (
        url.searchParams.get('pot') !== token ||
        token === 'expired' ||
        url.searchParams.get('potc') !== '1' ||
        url.searchParams.get('c') !== 'WEB' ||
        url.searchParams.get('cver') !== '2' ||
        url.searchParams.get('signature') !== `signed-${language}`
      )
        return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
      const text = language === 'en' ? 'This field behind me' : '我身后的这片空地';
      return Response.json({
        events: [
          { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: `\u200b ${text} \u200b`, pPenId: 3 }] },
          { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: `\u200b ${text} \u200b`, pPenId: 4 }] },
          ...(language === 'zh-Hans'
            ? [{ tStartMs: 500, dDurationMs: 1000, segs: [{ utf8: '即将变成一座城市' }] }]
            : []),
        ],
      });
    }),
  );
  await import('../src/platforms/youtube/page');
  video.currentTime = 1;
  controller = new CaptionController(
    createYoutubePlatform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(1100);
  expect(lines()[1].hidden).toBe(true);
  request(videoId, session, token, 1);
  await vi.advanceTimersByTimeAsync(1100);
  expect(lines()[1].hidden).toBe(true);

  token = 'ready';
  request(videoId, session, token, 3);
  request(videoId, session, 'expired', 2);
  await vi.advanceTimersByTimeAsync(1100);
  expect(lines()[0].textContent).toBe('This field behind me');
  expect(lines()[1].textContent).toBe('译文：This field behind me');
  expect(lines()[1].hidden).toBe(false);

  const downloads = vi.mocked(fetch).mock.calls.length;
  session = 'session-2';
  await vi.advanceTimersByTimeAsync(1100);
  expect(lines()[1].hidden).toBe(false);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(downloads);
  request(videoId, session, token, 4);
  await vi.advanceTimersByTimeAsync(1100);
  expect(lines()[1].textContent).toBe('译文：This field behind me');

  videoId = 'video-2';
  history.replaceState(null, '', '/watch?v=video-2');
  await vi.advanceTimersByTimeAsync(1100);
  expect(lines()[1].hidden).toBe(true);
  request(videoId, session, token, 5);
  await vi.advanceTimersByTimeAsync(1100);
  expect(lines()[0].textContent).toBe('This field behind me');
  expect(lines()[1].textContent).toBe('译文：This field behind me');
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'This field behind me' });
});

it('translates authored English sentences even when authored, automatic and browser target tracks exist', async () => {
  const { video, player, sendMessage, lines } = setup();
  const tracks = [
    { languageCode: 'zh-Hans', vssId: '.zh-Hans' },
    { languageCode: 'zh-Hans', vssId: 'a.zh-Hans', kind: 'asr' },
    { languageCode: 'en', vssId: 'a.en', kind: 'asr' },
    { languageCode: 'en', vssId: '.en' },
  ].map((track) => ({
    ...track,
    baseUrl: `https://www.youtube.com/api/timedtext?v=video-1&lang=${track.languageCode}&track=${track.vssId}`,
  }));
  Object.assign(player, {
    getOption: () => ({ languageCode: 'zh-Hans', vssId: '.zh-Hans' }),
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video-1' },
      captions: {
        playerCaptionsTracklistRenderer: { captionTracks: tracks },
      },
    }),
  });
  const targetTrack = {
    mode: 'showing',
    kind: 'subtitles',
    language: 'zh-Hans',
    cues: [{ startTime: 0, endTime: 100, text: '浏览器已有译文' }],
    activeCues: [],
  };
  Object.defineProperty(video, 'textTracks', { configurable: true, value: [targetTrack] });
  document.querySelector('.ytp-caption-window-container')!.innerHTML =
    '<span class="ytp-caption-segment">网站已有中文字幕</span>';
  const fetch = vi.fn(async (url: string) =>
    Response.json({
      events: url.includes('track=.en')
        ? [
            { tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: 'This field behind me' }] },
            { tStartMs: 2500, dDurationMs: 2000, segs: [{ utf8: 'will become a city.' }] },
            { tStartMs: 4500, dDurationMs: 7000, segs: [{ utf8: 'Go. Go.' }] },
          ]
        : [{ tStartMs: 0, dDurationMs: 100000, segs: [{ utf8: '错误的字幕轨道' }] }],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await import('../src/platforms/youtube/page');
  const settings = publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' });
  controller = new CaptionController(createYoutubePlatform, { ...settings, configured: false });
  await vi.advanceTimersByTimeAsync(1100);
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(sendMessage.mock.calls).toEqual([]);
  controller.update(settings);
  await playTo(video, 1.2);
  expect([...lines()].map((line) => line.textContent)).toEqual([
    'This field behind me will become a city.',
    '译文：This field behind me will become a city.',
  ]);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'prefetch',
    items: [
      { text: 'This field behind me will become a city.', segment: 0, needsSplit: false },
      { text: 'Go.', segment: 0, needsSplit: false },
    ],
  });
  expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('track'))).toEqual(['.en']);
  expect(targetTrack.mode).toBe('showing');
  expect(getComputedStyle(document.querySelector('.ytp-caption-window-container')!).opacity).toBe(
    '0',
  );
  await playTo(video, 3);
  expect(lines()[0].textContent).toBe('This field behind me will become a city.');
  expect(
    sendMessage.mock.calls
      .filter(([message]) => message.type === 'translate')
      .map(([message]) => message.text),
  ).toEqual(['This field behind me will become a city.']);
  await playTo(video, 4.5);
  expect([...lines()].map((line) => line.textContent)).toEqual(['Go.', '译文：Go.']);
  video.currentTime = 12;
  video.dispatchEvent(new Event('timeupdate'));
  expect([...lines()].map((line) => line.hidden)).toEqual([true, true]);
  controller.destroy();
  expect(
    getComputedStyle(document.querySelector('.ytp-caption-window-container')!).opacity,
  ).not.toBe('0');
});

it('downloads the source language and calls the Provider when website auto-translation is selected', async () => {
  const { video, player, sendMessage, lines } = setup();
  Object.assign(player, {
    getOption: () => ({
      languageCode: 'en',
      vssId: '.en',
      translationLanguage: { languageCode: 'zh-CN' },
    }),
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video-1' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: 'en',
              vssId: '.en',
              baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&tlang=zh-CN',
            },
          ],
        },
      },
    }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        Response.json({
          events: [
            {
              tStartMs: 2000,
              dDurationMs: 2000,
              segs: [{ utf8: url.includes('tlang=zh-CN') ? '网站已提供的译文' : 'Source phrase' }],
            },
          ],
        }),
      ),
    ),
  );
  await import('../src/platforms/youtube/page');
  video.currentTime = 2;
  controller = new CaptionController(
    createYoutubePlatform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(1500);
  expect(lines()[0].textContent).toBe('Source phrase');
  expect(lines()[1].textContent).toBe('译文：Source phrase');
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'Source phrase' });
});

it.each([
  { kind: 'asr', availableUrl: true },
  { kind: 'asr', availableUrl: false },
  { kind: 'authored', availableUrl: true },
])(
  'waits for the complete $kind source track before translating, URL=$availableUrl',
  async ({ kind, availableUrl }) => {
    const { video, player, sendMessage, lines } = setup();
    let recovered = false;
    Object.assign(player, {
      getOption: () => ({ vssId: kind === 'asr' ? 'a.en' : '.en' }),
      getPlayerResponse: () => ({
        videoDetails: { videoId: 'video-1' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                languageCode: 'en',
                kind,
                vssId: kind === 'asr' ? 'a.en' : '.en',
                baseUrl:
                  availableUrl || recovered
                    ? 'https://www.youtube.com/api/timedtext?v=video-1&lang=en'
                    : undefined,
              },
            ],
          },
        },
      }),
    });
    document.querySelector('.ytp-caption-window-container')!.innerHTML =
      '<div class="caption-window"><span class="ytp-caption-segment">We are</span></div>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        recovered
          ? Response.json({
              events: [
                { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'We are' }] },
                { tStartMs: 1500, dDurationMs: 1500, segs: [{ utf8: 'ready.' }] },
              ],
            })
          : new Response('', { status: 503 }),
      ),
    );
    await import('../src/platforms/youtube/page');
    const settings = publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' });
    controller = new CaptionController(createYoutubePlatform, settings);
    video.currentTime = 1;
    await vi.advanceTimersByTimeAsync(1500);
    expect(lines()[0].textContent).toBe('');
    expect(lines()[0].hidden).toBe(true);
    expect(lines()[1].textContent).toBe('');
    expect(
      sendMessage.mock.calls
        .filter(([message]) => message.type === 'translate')
        .map(([message]) => message.text),
    ).toEqual([]);
    const root = document.querySelector<HTMLElement>('.ytp-caption-window-container')!;
    expect(getComputedStyle(root).opacity).toBe('0');
    root.innerHTML =
      '<div class="caption-window"><span class="ytp-caption-segment">We are ready.</span></div>';
    await vi.advanceTimersByTimeAsync(450);
    expect(lines()[0].textContent).toBe('');
    expect(lines()[1].textContent).toBe('');
    document.querySelector('button')!.setAttribute('aria-pressed', 'false');
    await vi.advanceTimersByTimeAsync(150);
    expect([...lines()].map((line) => line.hidden)).toEqual([true, true]);
    document.querySelector('button')!.setAttribute('aria-pressed', 'true');
    await vi.advanceTimersByTimeAsync(1500);
    expect(lines()[0].textContent).toBe('');
    recovered = true;
    await vi.advanceTimersByTimeAsync(16000);
    expect([...lines()].map((line) => line.textContent)).toEqual([
      'We are ready.',
      '译文：We are ready.',
    ]);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'We are ready.' });
    controller.destroy();
    expect(getComputedStyle(root).opacity).not.toBe('0');
    expect(root.textContent).toBe('We are ready.');
  },
);

it('keeps custom captions in a fullscreen ancestor and restores the website layers on exit', async () => {
  const { video, player, lines } = setup();
  const fullscreen = document.createElement('div');
  player.replaceWith(fullscreen);
  fullscreen.append(player);
  document.querySelector('.ytp-caption-window-container')!.innerHTML =
    '<div class="caption-window"><span class="ytp-caption-segment">Visible source.</span></div>';
  Object.assign(player, {
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video-1' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: 'en',
              vssId: '.en',
              baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en',
            },
          ],
        },
      },
    }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        events: [{ tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'Visible source.' }] }],
      }),
    ),
  );
  await import('../src/platforms/youtube/page');
  controller = new CaptionController(
    createYoutubePlatform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(1500);
  expect([...lines()].map((line) => line.textContent)).toEqual([
    'Visible source.',
    '译文：Visible source.',
  ]);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreen });
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(450);
  expect(
    fullscreen
      .querySelector(':scope > [data-subline-overlay]')
      ?.shadowRoot?.querySelector('.original')?.textContent,
  ).toBe('Visible source.');
  expect(getComputedStyle(document.querySelector('.ytp-caption-window-container')!).opacity).toBe(
    '0',
  );
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: video });
  video.dispatchEvent(new Event('timeupdate'));
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(
    getComputedStyle(document.querySelector('.ytp-caption-window-container')!).opacity,
  ).not.toBe('0');
});

it('keeps custom captions in the player when the whole document is fullscreen', async () => {
  const { player } = setup();
  controller = new CaptionController(
    createYoutubePlatform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(0);
  const host = player.querySelector(':scope > [data-subline-overlay]');
  expect(host).not.toBeNull();
  for (const root of [document.documentElement, document.body]) {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: root });
    await vi.advanceTimersByTimeAsync(150);
    expect([...document.querySelectorAll('[data-subline-overlay]')]).toEqual([host]);
    expect(root.classList.contains('subline-player')).toBe(false);
  }
});

it('sends complete English sentences to the Provider and displays its translations below the source', async () => {
  const { video, player, sendMessage, lines } = setup();
  Object.assign(player, {
    getOption: () => ({ vssId: '.en' }),
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video-1' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: ['en', 'zh-Hans'].map((languageCode) => ({
            languageCode,
            vssId: `.${languageCode}`,
            baseUrl: `https://www.youtube.com/api/timedtext?v=video-1&lang=${languageCode}`,
          })),
        },
      },
    }),
  });
  const requests: { url: string; texts: string[] }[] = [];
  const transcripts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/timedtext')) {
        transcripts.push(new URL(url).searchParams.get('lang')!);
        return Response.json({
          events: [
            { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'This field behind me' }] },
            { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'will become a city.' }] },
            { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: 'Let’s build it.' }] },
          ],
        });
      }
      const texts = requestedTexts(init!);
      requests.push({ url, texts });
      return providerReply(texts, (text) =>
        text === 'This field behind me will become a city.'
          ? '我身后的这片空地将变成一座城市。'
          : '让我们建造它。',
      );
    }),
  );
  const saved = {
    ...DEFAULT_SETTINGS,
    baseUrl: 'https://provider.example/v1',
    apiKey: 'fixture-key',
    model: 'fixture-model',
  };
  const queue = new TranslationQueue();
  sendMessage.mockImplementation(async (message) => {
    if (message.type === 'translate')
      return {
        ok: true,
        data: await (message.cacheOnly
          ? queue.lookup(saved, message.text!)
          : queue.request('video', saved, message.text!)),
      };
    if (message.type === 'prefetch') queue.prefetch('video', saved, message.items!);
    return { ok: true };
  });
  await import('../src/platforms/youtube/page');
  controller = new CaptionController(createYoutubePlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toEqual([
    {
      url: 'https://provider.example/v1/chat/completions',
      texts: ['This field behind me will become a city.'],
    },
    {
      url: 'https://provider.example/v1/chat/completions',
      texts: ['Let’s build it.'],
    },
  ]);
  expect(transcripts).toEqual(['en']);
  video.currentTime = 1;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(0);
  expect([...lines()].map((line) => line.textContent)).toEqual([
    'This field behind me will become a city.',
    '我身后的这片空地将变成一座城市。',
  ]);
  await playTo(video, 2.5);
  expect(lines()[1].textContent).toBe('我身后的这片空地将变成一座城市。');
  await playTo(video, 3);
  expect([...lines()].map((line) => line.textContent)).toEqual([
    'Let’s build it.',
    '让我们建造它。',
  ]);
  expect(requests.map((request) => request.texts)).toEqual([
    ['This field behind me will become a city.'],
    ['Let’s build it.'],
  ]);
  queue.reset();
});

it('waits for the configured source language instead of translating the website target-language DOM', async () => {
  const { video, player, sendMessage, lines } = setup();
  let englishAvailable = false;
  Object.assign(player, {
    getOption: () => ({ languageCode: 'zh-Hans', vssId: '.zh-Hans' }),
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video-1' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: (englishAvailable ? ['zh-Hans', 'en'] : ['zh-Hans']).map(
            (languageCode) => ({
              languageCode,
              vssId: `.${languageCode}`,
              baseUrl: `https://www.youtube.com/api/timedtext?v=video-1&lang=${languageCode}`,
            }),
          ),
        },
      },
    }),
  });
  document.querySelector('.ytp-caption-window-container')!.innerHTML =
    '<span class="ytp-caption-segment">现有中文字幕。</span>';
  const fetch = vi.fn(async () =>
    Response.json({
      events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: 'English source.' }] }],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await import('../src/platforms/youtube/page');
  controller = new CaptionController(
    createYoutubePlatform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(1500);
  expect([...lines()].map((line) => line.hidden)).toEqual([true, true]);
  expect(sendMessage.mock.calls).toEqual([]);
  englishAvailable = true;
  video.currentTime = 1;
  await vi.advanceTimersByTimeAsync(1500);
  expect([...lines()].map((line) => line.textContent)).toEqual([
    'English source.',
    '译文：English source.',
  ]);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'English source.' });
});

it('keeps the YouTube source across target/provider/style changes, seeks, blob renewal and signed URL renewal', async () => {
  const { video, player, lines } = setup();
  let token = 'old';
  let active = '.en';
  let videoId = 'video-1';
  Object.assign(player, {
    getOption: () => ({ vssId: active }),
    getPlayerResponse: () => ({
      videoDetails: { videoId },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { languageCode: 'en', vssId: '.en' },
            { languageCode: 'en', vssId: 'a.en', kind: 'asr' },
            { languageCode: 'es', vssId: '.es' },
          ].map((track) => ({
            ...track,
            baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${track.languageCode}&signature=${token}`,
          })),
        },
      },
    }),
  });
  const fetch = vi.fn(async () =>
    Response.json({
      events: [{ tStartMs: 0, dDurationMs: 90000, segs: [{ utf8: 'Cached source.' }] }],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await import('../src/platforms/youtube/page');
  const saved = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' };
  controller = new CaptionController(createYoutubePlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  for (const next of [
    { ...saved, targetLanguage: 'ja' },
    { ...saved, model: 'other', baseUrl: 'https://other.example/v1', apiKey: 'other' },
    { ...saved, original: { ...saved.original, size: 36 } },
  ]) {
    controller.update(publicSettings(next));
    await vi.advanceTimersByTimeAsync(1200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lines()[0].textContent).toBe('Cached source.');
  }
  token = 'fresh';
  Object.defineProperty(video, 'currentSrc', { value: 'blob:renewed' });
  history.replaceState(null, '', '/watch?v=video-1&tracking=changed');
  video.currentTime = 33;
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(1600);
  expect(fetch).toHaveBeenCalledTimes(1);
  controller.update({ ...publicSettings(saved), enabled: false });
  await vi.advanceTimersByTimeAsync(0);
  controller.update(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(1200);
  expect(fetch).toHaveBeenCalledTimes(1);
  active = 'a.en';
  await vi.advanceTimersByTimeAsync(1200);
  expect(fetch).toHaveBeenCalledTimes(2);
  controller.update(publicSettings({ ...saved, sourceLanguage: 'es' }));
  await vi.advanceTimersByTimeAsync(1200);
  expect(fetch).toHaveBeenCalledTimes(3);
  videoId = 'video-2';
  history.replaceState(null, '', '/watch?v=video-2');
  await vi.advanceTimersByTimeAsync(1200);
  expect(fetch).toHaveBeenCalledTimes(4);
});
