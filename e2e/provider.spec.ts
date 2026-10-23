import { expect, test } from '@playwright/test';
import {
  apiKey,
  denseCue,
  draftPrefix,
  nextSource,
  nextTranslation,
  source,
  thirdSource,
  thirdTranslation,
  translation,
  withPlayer,
  errorsShown,
  preloadNext,
} from './harness';
import { providerTimeoutMs } from '../src/shared/tuning';

for (const platform of ['youtube', 'hbo', 'x'] as const) {
  for (const draft of ['complete', 'truncated'] as const) {
    test(`${platform}: a ${draft} draft before the final JSON never reaches the overlay or cache`, async ({}, info) => {
      await withPlayer(
        platform,
        info,
        async (p) => {
          await p.play();
          await p.pair(source, translation);
          await preloadNext(p);
          const openingCount = p.posts.length;
          await p.pause();
          await p.seek(35);
          await p.pair(nextSource, nextTranslation);
          await p.seek(2);
          await p.pair(source, translation);
          expect(p.posts).toHaveLength(openingCount);
          const frames = await p.frames();
          expect(frames.filter((f) => f.translation.startsWith(draftPrefix))).toEqual([]);
          if (draft === 'truncated')
            await info.attach('final-cached.png', {
              body: await p.page.screenshot(),
              contentType: 'image/png',
            });
        },
        { draft },
      );
    });
  }

  test(`${platform}: an invalid key shows a safe error and recovers once fixed`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.settings({ apiKey: 'e2e-invalid-key' });
      await p.play();
      await expect(p.translated).toHaveText('Subline: The API Key is invalid or expired.');
      await expect(p.translated).toHaveClass(/error/);
      await expect(p.original).toHaveText(source);
      expect(p.posts.map((post) => post.status)).toContain(401);
      expect(p.posts.every((post) => post.status === 401)).toBe(true);
      await p.settings({ apiKey });
      await p.pair(source, translation);
      await expect(p.translated).not.toHaveClass(/error/);
      expect(p.posts.at(-1)!.status).toBe(200);
      expect(await errorsShown(p)).toEqual(['Subline: The API Key is invalid or expired.']);
    });
  });

  test(`${platform}: a failed caption is not retried and the next caption translates after the backoff`, async ({}, info) => {
    test.setTimeout(60_000);
    await withPlayer(
      platform,
      info,
      async (p) => {
        const failure = 'Subline: The provider returned HTTP 503. Try again later.';
        await expect.poll(() => p.downloads.length).toBeGreaterThan(0);
        const downloads = p.downloads.length;
        await p.page.evaluate(() => window.fixture.switchVideo('second'));
        await expect.poll(() => p.downloads.length).toBeGreaterThan(downloads);
        await p.play();
        await expect(p.translated).toHaveText(failure);
        await expect(p.original, 'A failed caption shows its source').toHaveText(nextSource);
        await p.page.waitForTimeout(16_000);
        await expect(p.translated).toHaveText(failure);
        expect(p.posts.map((post) => post.status)).toEqual([503]);
        await p.page.evaluate(() => window.fixture.switchVideo('third'));
        await p.play();
        await p.pair(thirdSource, thirdTranslation);
        expect(p.posts.map((post) => post.status)).toEqual([503, 200]);
        expect(await errorsShown(p)).toEqual([failure]);
      },
      { unavailable: 1 },
    );
  });
}

test('youtube: a stalled opening batch times out without a retry and the next batch still appears', async ({}, info) => {
  test.setTimeout(providerTimeoutMs + 30_000);
  await withPlayer(
    'youtube',
    info,
    async (p) => {
      await p.play();
      await expect.poll(() => p.posts.length).toBeGreaterThan(0);
      expect(p.posts[0].inputs.map((input) => input.text)).toEqual([denseCue(0).text]);
      await expect(p.translated).toHaveText('Translating');
      await expect(p.translated).toHaveCSS('font-size', '20px');
      await p.pause();
      expect(
        await p.page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime),
      ).toBeLessThan(denseCue(0).end);
      await p.page.waitForTimeout(providerTimeoutMs + 1500);
      const first = p.posts[0].inputs.map((input) => input.text).join('\n');
      expect(
        p.posts.filter((post) => post.inputs.map((input) => input.text).join('\n') === first),
      ).toHaveLength(1);
      await expect(p.translated).toHaveText('Request timed out');
      await expect(p.translated).toHaveCSS('color', 'rgb(255, 204, 0)');
      await expect(p.translated).toHaveCSS('font-size', '20px');
      const later = denseCue(4);
      await p.seek(later.start + 0.2);
      await p.play();
      await p.pair(later.text, later.translation);
      await p.posts[0].route.abort('timedout').catch(() => undefined);
    },
    { dense: true, stallFirst: true },
  );
});
