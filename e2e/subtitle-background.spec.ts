import { expect, test } from '@playwright/test';
import { source, translation, withPlayer } from './harness';

for (const platform of ['youtube', 'hbo', 'x'] as const) {
  test(`${platform}: bilingual captions share one fitted background`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      const background = p.overlay.locator('.stack');
      await expect(background).toBeHidden();
      await p.play();
      await p.pair(source, translation);
      await p.page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
      await expect(background).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.45)');
      await expect(background).toHaveCSS('gap', '6px');
      await expect(p.original).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(p.translated).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const original = (await p.original.boundingBox())!;
      const translated = (await p.translated.boundingBox())!;
      const box = (await background.boundingBox())!;
      expect(translated.y - original.y - original.height).toBeCloseTo(6);
      expect(box.width).toBeCloseTo(Math.max(original.width, translated.width) + 24);
      expect(box.height).toBeCloseTo(original.height + translated.height + 14);
      await info.attach('bilingual-background.png', {
        body: await p.page.screenshot(),
        contentType: 'image/png',
      });
      await p.settings({ translationOnly: true });
      await expect(p.original).toBeHidden();
      await expect(p.translated).toBeVisible();
      await expect
        .poll(async () => (await background.boundingBox())!.height)
        .toBeCloseTo(translated.height + 8);
      await p.settings({ translationOnly: false });
      await p.pair(source, translation);
      await p.seek(20);
      await expect(p.original).toBeHidden();
      await expect(p.translated).toBeHidden();
      await expect(background).toBeHidden();
    });
  });
}
