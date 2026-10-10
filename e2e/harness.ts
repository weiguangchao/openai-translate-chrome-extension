import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { planSentenceCap, translationBatchLimit } from '../src/shared/limits';
import type { Settings } from '../src/shared/settings';
import { TRACE_PREFIX, type TraceEvent } from '../src/shared/trace';
import { longCaption, longCaptionParts, longTranslations } from '../tests/fixtures/long-caption';

export type Platform = 'youtube' | 'hbo' | 'x';
export const providerUrl = 'https://www.youtube.com/__e2e_provider__/v1/chat/completions';
export const elsewhereUrl = 'https://example.org/';
export const apiKey = 'e2e-fake-key';
export const source = 'The moon is bright tonight.';
export const translation = '今晚的月亮很明亮。';
export const nextSource = 'We will meet at the station.';
export const nextTranslation = '我们将在车站见面。';
export const traditionalSource = '火車明天到達。';
export const traditionalTranslation = '火车明天到达。';
export const asrSource = 'This is the automatic caption.';
export const asrTranslation = '这是自动字幕。';
export const thirdSource = 'The ferry leaves at noon.';
export const thirdTranslation = '渡轮中午出发。';
export const gardenSource = 'The garden is quiet.';
export const draftPrefix = '草稿：';
const translations: Record<string, string> = {
  [source]: translation,
  [nextSource]: nextTranslation,
  [traditionalSource]: traditionalTranslation,
  [asrSource]: asrTranslation,
  [thirdSource]: thirdTranslation,
  [gardenSource]: '花园很安静。',
};
export interface Frame {
  at: number;
  time: number;
  id: string;
  language: string;
  original: string;
  translation: string;
}
declare global {
  interface Window {
    fixture: {
      select(language: string | null, kind?: string): void;
      switchVideo(id: string): void;
      native(text: string): void;
    };
    subtitleFrames: Frame[];
  }
}
interface Input {
  id: number;
  text: string;
}
interface Post {
  inputs: Input[];
  body: Record<string, unknown>;
  worker: string;
  released: boolean;
  status: number;
  route: Route;
}
interface Cue {
  start: number;
  end: number;
  text: string;
}
interface Options {
  long?: boolean;
  dense?: boolean;
  stallFirst?: boolean;
  hold?: boolean;
  retry?: boolean;
  draft?: 'complete' | 'truncated';
  unavailable?: number;
  holdTimeline?: boolean;
  recordVideo?: boolean;
  latency?: (post: number) => number;
}

const denseCueSeconds = 4;

export function denseCue(index: number) {
  const start = index * denseCueSeconds;
  return {
    start,
    end: start + denseCueSeconds,
    text: `Sentence ${index + 1}.`,
    translation: `译文 ${index + 1}`,
  };
}

export class Player {
  page!: Page;
  settingsPage!: Page;
  extensionId = '';
  posts: Post[] = [];
  requests: { url: string; method: string; worker: string | null }[] = [];
  unexpected: string[] = [];
  errors: string[] = [];
  trace: TraceEvent[] = [];
  failed: { url: string; error: string | null }[] = [];
  hold: boolean;
  releaseTimeline = () => {};
  private timeline: Promise<void>;
  constructor(
    readonly context: BrowserContext,
    readonly platform: Platform,
    readonly options: Options,
  ) {
    this.hold = options.hold ?? false;
    this.timeline = options.holdTimeline
      ? new Promise((resolve) => (this.releaseTimeline = resolve))
      : Promise.resolve();
  }
  get origin() {
    return {
      youtube: 'https://www.youtube.com',
      hbo: 'https://play.hbomax.com',
      x: 'https://x.com',
    }[this.platform];
  }
  get url() {
    return this.urlFor('first');
  }
  urlFor(id: string) {
    return {
      youtube: `${this.origin}/watch?v=${id}`,
      hbo: `${this.origin}/video/watch/${id}`,
      x: `${this.origin}/e2e/status/${id}`,
    }[this.platform];
  }
  get overlay() {
    return this.page.locator('[data-subline-overlay]');
  }
  get original() {
    return this.overlay.locator('.original');
  }
  get translated() {
    return this.overlay.locator('.translation');
  }
  get downloads() {
    return this.requests.filter((r) => /timedtext|\.mpd|\.m3u8|\.vtt/.test(r.url));
  }
  async setup() {
    const worker =
      this.context.serviceWorkers()[0] ?? (await this.context.waitForEvent('serviceworker'));
    this.extensionId = new URL(worker.url()).host;
    expect(worker.url()).toBe(`chrome-extension://${this.extensionId}/background.js`);
    this.context.on('weberror', (error) => this.errors.push(error.error().message));
    this.context.on('console', (message) => {
      const text = message.text();
      if (text.startsWith(TRACE_PREFIX))
        this.trace.push(JSON.parse(text.slice(TRACE_PREFIX.length)));
    });
    this.context.on('requestfailed', (request) =>
      this.failed.push({ url: request.url(), error: request.failure()?.errorText ?? null }),
    );
    await this.context.route('**/*', (route) => this.route(route));
    this.settingsPage = await this.context.newPage();
    await this.settingsPage.goto(`chrome-extension://${this.extensionId}/popup.html`);
    await this.settings({
      enabled: true,
      youtube: true,
      hbo: true,
      x: true,
      baseUrl: providerUrl.replace('/chat/completions', ''),
      apiKey,
      model: 'e2e-fixed-model',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
    });
    this.page = await this.context.newPage();
    await this.page.goto(this.url);
    await expect
      .poll(() =>
        this.page
          .locator('video')
          .evaluate((v: HTMLVideoElement) => v.seekable.length && v.duration),
      )
      .toBe(90);
  }
  async settings(patch: Partial<Settings>) {
    await this.settingsPage.evaluate(async (patch) => {
      const key = 'subline.settings.v1';
      const current = (await chrome.storage.local.get(key))[key];
      await chrome.storage.local.set({ [key]: { ...current, ...patch } });
    }, patch);
    const publicPatch = Object.fromEntries(
      Object.entries(patch).filter(([key]) => !['apiKey', 'baseUrl', 'model'].includes(key)),
    );
    await expect
      .poll(() =>
        this.settingsPage.evaluate(
          async () => (await chrome.runtime.sendMessage({ type: 'settings' })).data,
        ),
      )
      .toMatchObject({ ...publicPatch, configured: true });
  }
  async play() {
    await this.page.getByRole('button', { name: 'Play fixture', exact: true }).click();
  }
  async pause() {
    await this.page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  }
  async seek(time: number) {
    await this.page.locator('video').evaluate((v: HTMLVideoElement, time) => {
      v.currentTime = time;
    }, time);
    await expect
      .poll(() => this.page.locator('video').evaluate((v: HTMLVideoElement) => v.seeking))
      .toBe(false);
  }
  async frames() {
    return this.page.evaluate(() => window.subtitleFrames);
  }
  async watchWorker() {
    const session = await this.context.newCDPSession(this.page);
    const script = `chrome-extension://${this.extensionId}/background.js`;
    const history: { at: number; versionId: string; runningStatus: string }[] = [];
    let current: { versionId: string; runningStatus: string } | undefined;
    session.on('ServiceWorker.workerVersionUpdated', (event) => {
      for (const v of event.versions) {
        if (v.scriptURL !== script) continue;
        current = v;
        const last = history.at(-1);
        if (last?.versionId !== v.versionId || last.runningStatus !== v.runningStatus)
          history.push({ at: Date.now(), versionId: v.versionId, runningStatus: v.runningStatus });
      }
    });
    await session.send('ServiceWorker.enable');
    await expect.poll(() => current?.runningStatus).toBe('running');
    return {
      history,
      status: () => current?.runningStatus,
      stop: () => session.send('ServiceWorker.stopWorker', { versionId: current!.versionId }),
      detach: () => session.detach(),
    };
  }
  async pair(original: string, translated: string) {
    await expect(this.original).toHaveText(original);
    await expect(this.translated).toHaveText(translated);
    await expect(this.original).toBeVisible();
    await expect(this.translated).toBeVisible();
    await expect(this.overlay).toHaveCount(1);
  }
  async release(index: number) {
    const post = this.posts[index];
    expect(post.released).toBe(false);
    post.released = true;
    const results = post.inputs.map(({ id, text }) => {
      const part = longCaptionParts.indexOf(text);
      if (part >= 0) return { id, translation: longTranslations[part] };
      const sentence = /^Sentence (\d+)\.$/.exec(text);
      if (sentence) return { id, translation: denseCue(Number(sentence[1]) - 1).translation };
      expect(translations[text], `Known Provider input: ${text}`).toBeTruthy();
      return { id, translation: translations[text] };
    });
    let content = JSON.stringify({ results });
    if (this.options.draft) {
      const drafts = post.inputs.map(({ id, text }) => ({
        id,
        translation: `${draftPrefix}${text}`,
      }));
      const draft = JSON.stringify({ results: drafts });
      content = `${this.options.draft === 'truncated' ? draft.slice(0, -2) : draft}\nFinal\n${content}`;
    }
    await post.route.fulfill({ json: { choices: [{ message: { content } }] } });
  }
  private cues(id: string, language: string, kind: string): Cue[] {
    if (language === 'zh-CN')
      throw new Error('Website target-language track must never be downloaded');
    if (language === 'zh-TW') return [{ start: 0, end: 90, text: traditionalSource }];
    if (kind === 'asr') return [{ start: 0, end: 90, text: asrSource }];
    if (id === 'second') return [{ start: 0, end: 90, text: nextSource }];
    if (id === 'third') return [{ start: 0, end: 90, text: thirdSource }];
    if (this.options.long) return [{ start: 36, end: 45, text: longCaption }];
    if (this.options.dense)
      return Array.from({ length: planSentenceCap + translationBatchLimit }, (_, index) => {
        const cue = denseCue(index);
        return { start: cue.start, end: cue.end, text: cue.text };
      });
    return [
      { start: 0, end: 20, text: source },
      { start: 30, end: 50, text: nextSource },
      { start: 65, end: 90, text: gardenSource },
    ];
  }
  private async route(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin === `chrome-extension://${this.extensionId}` ||
      url.href.startsWith(`chrome-extension://${this.extensionId}/`)
    )
      return route.continue();
    const worker = request.serviceWorker()?.url() ?? null;
    this.requests.push({ url: url.href, method: request.method(), worker });
    if (
      request.isNavigationRequest() &&
      ['first', 'second', 'third'].some((id) => url.href === this.urlFor(id))
    )
      return route.fulfill({
        path: path.resolve('e2e/fixtures/player.html'),
        contentType: 'text/html',
      });
    if (url.href === elsewhereUrl && request.isNavigationRequest())
      return route.fulfill({
        body: '<!doctype html><title>Elsewhere</title>',
        contentType: 'text/html',
      });
    if (url.origin === this.origin && url.pathname === '/e2e/player.webm') {
      const body = await readFile('e2e/fixtures/player.webm');
      const range = request.headers().range?.match(/^bytes=(\d+)-(\d*)$/);
      const headers = { 'accept-ranges': 'bytes' };
      if (!range) return route.fulfill({ body, contentType: 'video/webm', headers });
      const from = Number(range[1]);
      const to = range[2] ? Number(range[2]) : body.length - 1;
      return route.fulfill({
        status: 206,
        body: body.subarray(from, to + 1),
        contentType: 'video/webm',
        headers: { ...headers, 'content-range': `bytes ${from}-${to}/${body.length}` },
      });
    }
    if (
      this.platform === 'youtube' &&
      url.origin === this.origin &&
      url.pathname === '/api/timedtext' &&
      url.searchParams.get('fmt') === 'json3'
    ) {
      const cues = this.cues(
        url.searchParams.get('v')!,
        url.searchParams.get('lang')!,
        url.searchParams.get('kind')!,
      );
      return route.fulfill({
        json: {
          events: cues.map((c) => ({
            tStartMs: c.start * 1000,
            dDurationMs: (c.end - c.start) * 1000,
            segs: [{ utf8: c.text }],
          })),
        },
      });
    }
    const resource = url.pathname.match(
      /^\/e2e\/(first|second|third)\/(manifest\.mpd|en\.vtt|en-asr\.vtt|zh-TW\.vtt|zh-CN\.vtt)$/,
    );
    if (this.platform === 'hbo' && url.origin === this.origin && resource) {
      const [, id, file] = resource;
      if (file === 'manifest.mpd') {
        await this.timeline;
        return route.fulfill({
          contentType: 'application/dash+xml',
          body: `<MPD type="static" mediaPresentationDuration="PT90S"><Period start="PT0S" duration="PT90S">${['en', 'en-asr', 'zh-TW', 'zh-CN'].map((lang) => `<AdaptationSet contentType="text" lang="${lang === 'en-asr' ? 'en' : lang}"><Role value="${lang === 'en-asr' ? 'caption' : 'subtitle'}"/><Representation id="${lang}" mimeType="text/vtt"><BaseURL>${lang}.vtt</BaseURL></Representation></AdaptationSet>`).join('')}</Period></MPD>`,
        });
      }
      const cues = this.cues(
        id,
        file.replace('.vtt', '').replace('-asr', ''),
        file === 'en-asr.vtt' ? 'asr' : 'authored',
      );
      return route.fulfill({ contentType: 'text/vtt', body: webvtt(cues) });
    }
    const hls = url.pathname.match(
      /^\/e2e\/(first|second|third)\/(pl\/s0|subs)\/(en|en-asr|zh-TW|zh-CN)\.(m3u8|vtt)$/,
    );
    if (this.platform === 'x' && url.origin === 'https://video.twimg.com' && hls) {
      const [, id, folder, file, extension] = hls;
      const cues = this.cues(id, file.replace('-asr', ''), file === 'en-asr' ? 'asr' : 'authored');
      const headers = { 'access-control-allow-origin': '*' };
      if (folder === 'pl/s0' && extension === 'm3u8') {
        await this.timeline;
        return route.fulfill({
          contentType: 'application/x-mpegURL',
          headers,
          body: `#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:90\n#EXTINF:90.000,\n/e2e/${id}/subs/${file}.vtt\n#EXT-X-ENDLIST\n`,
        });
      }
      if (folder === 'subs' && extension === 'vtt')
        return route.fulfill({ contentType: 'text/vtt', headers, body: webvtt(cues) });
    }
    if (
      url.href === providerUrl &&
      request.method() === 'POST' &&
      worker === `chrome-extension://${this.extensionId}/background.js`
    ) {
      const body = request.postDataJSON();
      const inputs = JSON.parse(
        body.messages.find((m: { role: string }) => m.role === 'user').content,
      );
      const key = request.headers().authorization?.replace(/^Bearer /, '');
      const post: Post = { inputs, body, worker, route, released: false, status: 200 };
      const unavailable = this.posts.filter((p) => p.status === 503).length;
      this.posts.push(post);
      if (key !== apiKey) post.status = 401;
      else if (unavailable < (this.options.unavailable ?? 0)) post.status = 503;
      else if (this.options.retry && this.posts.length === 1) post.status = 400;
      if (post.status !== 200) {
        post.released = true;
        const message = {
          400: 'response_format is not supported',
          401: `Incorrect API key provided: ${key}`,
          503: 'Service temporarily unavailable',
        }[post.status];
        return route.fulfill({ status: post.status, json: { error: { message } } });
      }
      const index = this.posts.length - 1;
      const latency = this.options.latency?.(index);
      if (latency !== undefined)
        setTimeout(() => void this.release(index).catch(() => undefined), latency);
      else if (!this.hold && !(this.options.stallFirst && this.posts.length === 1))
        await this.release(index);
      return;
    }
    this.unexpected.push(`${request.method()} ${url.href}`);
    await route.abort('blockedbyclient');
  }
}

function webvtt(cues: Cue[]): string {
  const stamp = (seconds: number) =>
    `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n')}`;
}

export async function withPlayer(
  platform: Platform,
  info: TestInfo,
  run: (player: Player) => Promise<void>,
  options: Options = {},
) {
  const profile = await mkdtemp(path.join(tmpdir(), 'subline-e2e-'));
  const extensionPath = path.resolve(process.env.SUBLINE_EXTENSION_PATH ?? 'dist');
  let context: BrowserContext | undefined;
  let player: Player | undefined;
  let succeeded = false;
  const attach = (name: string, value: unknown) =>
    info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
  try {
    expect(JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'))).toEqual(
      JSON.parse(await readFile('public/manifest.json', 'utf8')),
    );
    const files = (await readdir(extensionPath, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => path.join(e.parentPath, e.name))
      .sort();
    const digest = createHash('sha256');
    for (const file of files) {
      digest.update(path.relative(extensionPath, file));
      digest.update(await readFile(file));
    }
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: !process.env.E2E_HEADED,
      viewport: { width: 1280, height: 800 },
      ...(options.recordVideo && { recordVideo: { dir: info.outputPath('videos') } }),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const extensions = await context.newPage();
    await extensions.goto('chrome://extensions');
    await extensions.locator('#devMode').click();
    await expect(extensions.locator('#devMode')).toHaveAttribute('aria-pressed', 'true');
    await extensions.close();
    player = new Player(context, platform, options);
    await player.setup();
    await attach('build.json', {
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      node: process.version,
      playwright: JSON.parse(await readFile('node_modules/@playwright/test/package.json', 'utf8'))
        .version,
      browser: context.browser()?.version(),
      extensionId: player.extensionId,
      buildSha256: digest.digest('hex'),
    });
    await run(player);
    expect(player.unexpected, 'Every HTTP request must have an explicit fixture').toEqual([]);
    expect(player.errors, 'No uncaught browser or extension errors').toEqual([]);
    succeeded = true;
  } finally {
    try {
      if (player) {
        await attach('scheduler.json', player.trace);
        await attach('network.json', {
          requests: player.requests,
          posts: player.posts.map(({ route: _route, ...post }) => post),
          unexpected: player.unexpected,
          errors: player.errors,
          failed: player.failed,
        });
        if (player.page && !player.page.isClosed()) {
          await attach('subtitles.json', await player.frames());
          await attach(
            'media.json',
            await player.page.locator('video').evaluate((v: HTMLVideoElement) => ({
              time: v.currentTime,
              paused: v.paused,
              ready: v.readyState,
              seeking: v.seeking,
              error: v.error?.message,
            })),
          );
          if (!succeeded)
            await info.attach('failure.png', {
              body: await player.page.screenshot(),
              contentType: 'image/png',
            });
        }
      }
      if (context) {
        if (!succeeded) {
          const trace = info.outputPath('trace.zip');
          await context.tracing.stop({ path: trace });
          await info.attach('trace', { path: trace, contentType: 'application/zip' });
        } else await context.tracing.stop();
      }
    } finally {
      try {
        await context?.close();
        const video = player?.page?.video();
        if (video)
          await info.attach('playback.webm', {
            path: await video.path(),
            contentType: 'video/webm',
          });
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  }
}
