import { expect, test } from '@playwright/test';
import { maxInFlightRequests } from '../src/shared/limits';
import { longCaption, longCaptionParts, longTranslations } from '../tests/fixtures/long-caption';
import {
  denseCue,
  nextSource,
  nextTranslation,
  source,
  translation,
  withPlayer,
  preloadNext,
} from './harness';

for (const platform of ['youtube', 'hbo', 'x'] as const) {
  test(`${platform}: a long sentence goes out as separate captions and style changes preserve in-flight work`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.seek(40);
        await p.play();
        await expect.poll(() => p.posts.length).toBeGreaterThan(0);
        expect(p.posts[0].inputs).toEqual([{ id: 0, text: longCaptionParts[1] }]);
        await p.pause();
        const sent = p.posts.length;
        const host = await p.overlay.elementHandle();
        const downloads = p.downloads.length;
        await p.settings({ original: { color: '#FFFFFF', size: 32 } });
        await expect(p.original).toHaveCSS('font-size', '32px');
        expect(
          await host!.evaluate((node) => node === document.querySelector('[data-subline-overlay]')),
        ).toBe(true);
        expect(p.posts).toHaveLength(sent);
        expect(p.downloads).toHaveLength(downloads);
        await expect(p.original).toBeHidden();
        for (let index = 0; index < sent; index++) await p.release(index);
        await p.pair(longCaptionParts[1], longTranslations[1]);
        expect(p.posts).toHaveLength(sent);
        const inputs = p.posts.flatMap((post) => post.inputs.map((input) => input.text));
        expect(inputs).not.toContain(longCaption);
        expect(inputs.every((text) => longCaptionParts.includes(text))).toBe(true);
        expect(p.failed.filter((r) => r.url.includes('__e2e_provider__'))).toEqual([]);
        const frames = await p.frames();
        expect(frames.some((f) => f.original === longCaption)).toBe(false);
        for (const f of frames.filter((f) => f.original)) {
          const index = longCaptionParts.indexOf(f.original);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(f.translation).toBe(longTranslations[index]);
        }
      },
      { long: true, hold: true },
    );
  });

  test(`${platform}: pause permits completion, seek and resume reuse completed cache`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.play();
        await expect.poll(() => p.posts.length).toBeGreaterThan(0);
        await p.pause();
        await p.release(0);
        await p.pair(source, translation);
        await p.seek(35);
        await expect(p.original).toBeHidden();
        expect(p.posts).toHaveLength(1);
        await p.play();
        await expect.poll(() => p.posts.length).toBe(2);
        await p.release(1);
        await p.pair(nextSource, nextTranslation);
        await p.pause();
        const openingCount = p.posts.length;
        await p.seek(2);
        await p.pair(source, translation);
        await p.play();
        await expect
          .poll(() => p.page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
          .toBeGreaterThan(3.5);
        expect(p.posts).toHaveLength(openingCount);
        expect(p.downloads).toHaveLength(platform === 'youtube' ? 1 : 2);
        await p.pause();
        await p.page.evaluate(() => window.fixture.switchVideo('second'));
        await expect(p.original).toHaveText(nextSource);
        await p.pair(nextSource, nextTranslation);
        expect(p.posts).toHaveLength(openingCount);
      },
      { hold: true },
    );
  });

  test(`${platform}: paused uncached content waits for resume`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await expect.poll(() => p.downloads.length).toBeGreaterThan(0);
      const downloads = p.downloads.length;
      expect(p.posts).toHaveLength(0);
      await p.page.evaluate(() => window.fixture.switchVideo('second'));
      await expect.poll(() => p.downloads.length).toBeGreaterThan(downloads);
      await p.page.waitForTimeout(1500);
      await expect(p.original).toBeHidden();
      await expect(p.translated).toBeHidden();
      expect(p.posts).toHaveLength(0);
      await p.play();
      await p.pair(nextSource, nextTranslation);
      expect(p.posts).toHaveLength(1);
    });
  });

  test(`${platform}: a cached translation replaces the next caption without 翻译中`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await expect.poll(() => p.posts.length).toBeGreaterThan(0);
      await p.pair(source, translation);
      await preloadNext(p);
      const openingCount = p.posts.length;
      const before = (await p.frames()).length;
      await p.seek(27);
      await p.pair(nextSource, nextTranslation);
      const frames = (await p.frames()).slice(before);
      expect(
        frames.some((f) => f.original === nextSource && f.translation === nextTranslation),
      ).toBe(true);
      expect(
        frames.filter((f) => f.translation === '翻译中'),
        'A translation the worker already has never shows 翻译中 first',
      ).toEqual([]);
      expect(p.posts).toHaveLength(openingCount);
    });
  });
}

test('youtube: 1.5x playback sends the imminent caption alone and stays silent through continuous scrubbing', async ({}, info) => {
  await withPlayer(
    'youtube',
    info,
    async (p) => {
      await p.page.locator('video').evaluate((video: HTMLVideoElement) => {
        video.playbackRate = 1.5;
      });
      await p.play();
      await expect.poll(() => p.posts.length).toBe(maxInFlightRequests);
      expect(p.posts.map((post) => post.inputs.map((input) => input.text))).toEqual([
        [denseCue(0).text],
        [denseCue(1).text, denseCue(2).text],
      ]);
      await expect(p.translated).toHaveText('翻译中');
      await p.release(0);
      await p.pair(denseCue(0).text, denseCue(0).translation);
      await p.page.screenshot({ path: info.outputPath('opening.png') });
      await expect.poll(() => p.posts.length).toBe(maxInFlightRequests + 1);
      const before = p.posts.length;
      await p.page.locator('video').evaluate(async (video: HTMLVideoElement) => {
        for (const time of [28.8, 44.8, 60.8]) {
          video.currentTime = time;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
      expect(p.posts).toHaveLength(before);
      await expect.poll(() => p.posts.length).toBe(before + maxInFlightRequests);
      expect(p.posts.slice(before).map((post) => post.inputs.map((input) => input.text))).toEqual([
        [denseCue(15).text],
        [denseCue(16).text, denseCue(17).text],
      ]);
      await p.release(before);
      await p.pair(denseCue(15).text, denseCue(15).translation);
      await p.page.screenshot({ path: info.outputPath('landing.png') });
      const batches = p.trace.filter((event) => event.e === 'batch');
      expect(batches.length).toBeGreaterThan(0);
      expect(
        batches.every(
          (event) => event.playbackRate === 1.5 && Number(event.inFlight) <= maxInFlightRequests,
        ),
      ).toBe(true);
      expect(batches[0]).toMatchObject({ size: 1, atRisk: true, blocked: false });
    },
    { dense: true, hold: true, recordVideo: true },
  );
});

test('youtube: steady playback stays ahead of a Provider whose every fourth reply takes 15 s', async ({}, info) => {
  const steadyUntil = 60;
  test.setTimeout((steadyUntil + 40) * 1000);
  await withPlayer(
    'youtube',
    info,
    async (p) => {
      await p.play();
      await expect
        .poll(() => p.page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), {
          timeout: (steadyUntil + 20) * 1000,
          intervals: [1000],
        })
        .toBeGreaterThan(steadyUntil);
      const frames = await p.frames();
      expect(
        frames.filter((frame) => frame.time >= denseCue(1).start && frame.translation === '翻译中'),
      ).toEqual([]);
      expect(frames.some((frame) => frame.translation === denseCue(14).translation)).toBe(true);
      expect(p.trace.filter((event) => event.e === 'done' && event.result === 'aborted')).toEqual(
        [],
      );
    },
    { dense: true, latency: (post) => (post % 4 === 3 ? 15_000 : 3000), recordVideo: true },
  );
});
