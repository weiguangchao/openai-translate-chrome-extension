import { expect, test } from '@playwright/test';
import { source, translation, withPlayer } from './harness';
import { longCaptionParts, longTranslations } from '../tests/fixtures/long-caption';

test('youtube: bilingual captions share one fitted background', async ({}, info) => {
  await withPlayer('youtube', info, async (p) => {
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

test('x: captions resize with a small player without losing text or changing timing', async ({}, info) => {
  await withPlayer(
    'x',
    info,
    async (p) => {
      await p.seek(36);
      await p.play();
      await p.pair(longCaptionParts[0], longTranslations[0]);
      await p.pause();
      const posts = p.posts.length;
      const background = p.overlay.locator('.stack');
      await expect(p.original).toHaveCSS('font-size', '24px');
      await p.page.locator('#player').evaluate((node) => {
        node.style.width = '400px';
        node.style.height = '225px';
      });
      await expect(p.original).toHaveCSS('font-size', '15px');
      await expect(p.translated).toHaveCSS('font-size', '14px');
      await expect(background).toHaveCSS('gap', '3.75px');
      await p.pair(longCaptionParts[0], longTranslations[0]);
      const player = (await p.page.locator('#player').boundingBox())!;
      const box = (await background.boundingBox())!;
      expect(box.height).toBeLessThan(player.height / 2);
      expect(box.x).toBeGreaterThanOrEqual(player.x);
      expect(box.x + box.width).toBeLessThanOrEqual(player.x + player.width);
      await p.page
        .locator('#player')
        .screenshot({ path: '.artifacts/product-feedback/subtitles-after.png' });
      await p.page.getByRole('button', { name: 'Fullscreen fixture', exact: true }).click();
      await expect(p.original).toHaveCSS('font-size', '24px');
      await expect(p.translated).toHaveCSS('font-size', '22px');
      await expect(background).toHaveCSS('gap', '6px');
      await p.pair(longCaptionParts[0], longTranslations[0]);
      await p.page.evaluate(() => document.exitFullscreen());
      await expect(p.original).toHaveCSS('font-size', '15px');
      await p.settings({ translation: { size: 12, color: '#FFFFFF' } });
      await expect(p.translated).toHaveCSS('font-size', '12px');
      expect(p.posts).toHaveLength(posts);
      await p.seek(39.1);
      await p.play();
      await p.pair(longCaptionParts[1], longTranslations[1]);
    },
    { long: true },
  );
});
