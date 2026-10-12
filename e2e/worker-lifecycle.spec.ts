import { expect, test } from '@playwright/test';
import {
  elsewhereUrl,
  gardenSource,
  nextSource,
  nextTranslation,
  source,
  thirdSource,
  thirdTranslation,
  translation,
  withPlayer,
  expectStored,
  preloadNext,
} from './harness';

for (const platform of ['youtube', 'hbo', 'x'] as const) {
  test(`${platform}: returning to the same tab from another site still translates after a pause`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await p.pair(source, translation);
      const openingCount = p.posts.length;
      await p.pause();
      await p.page.waitForTimeout(500);
      await p.page.goto(elsewhereUrl);
      await p.page.goto(p.urlFor('third'));
      await expect
        .poll(() =>
          p.page
            .locator('video')
            .evaluate((v: HTMLVideoElement) => v.seekable.length && v.duration),
        )
        .toBe(90);
      await p.play();
      await p.pair(thirdSource, thirdTranslation);
      expect(p.posts).toHaveLength(openingCount + 1);
      expect(p.posts.at(-1)!.inputs).toEqual([{ id: 0, text: thirdSource }]);
    });
  });

  test(`${platform}: a stopped worker restarts on new page demand`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await expect.poll(() => p.posts.length).toBeGreaterThan(0);
      const openingCount = p.posts.length;
      await p.pair(source, translation);
      await p.pause();
      const worker = await p.watchWorker();
      await worker.stop();
      await expect.poll(worker.status).toBe('stopped');
      await p.page.evaluate(() => window.fixture.switchVideo('third'));
      await p.play();
      await p.pair(thirdSource, thirdTranslation);
      await expect.poll(worker.status).toBe('running');
      expect(p.posts).toHaveLength(openingCount + 1);
      expect(p.posts.at(-1)!.inputs).toEqual([{ id: 0, text: thirdSource }]);
      await info.attach('worker.json', {
        body: JSON.stringify(worker.history),
        contentType: 'application/json',
      });
      await worker.detach();
    });
  });

  test(`${platform}: a restarted worker keeps the translations it already had`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await expect.poll(() => p.posts.length).toBeGreaterThan(0);
      await p.pair(source, translation);
      await preloadNext(p);
      await p.seek(59);
      await expectStored(p, gardenSource);
      const openingCount = p.posts.length;
      await p.pause();
      const worker = await p.watchWorker();
      await worker.stop();
      await expect.poll(worker.status).toBe('stopped');
      await p.seek(31);
      await p.play();
      await p.pair(nextSource, nextTranslation);
      await expect.poll(worker.status).toBe('running');
      expect(p.posts, 'The restarted worker answers from its stored translations').toHaveLength(
        openingCount,
      );
      await worker.detach();
    });
  });
}
