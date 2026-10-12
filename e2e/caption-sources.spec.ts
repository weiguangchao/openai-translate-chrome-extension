import { expect, test } from '@playwright/test';
import {
  asrSource,
  asrTranslation,
  traditionalSource,
  traditionalTranslation,
  nextSource,
  nextTranslation,
  source,
  translation,
  withPlayer,
  expectNativeHidden,
  expectOpeningPosts,
} from './harness';

for (const platform of ['youtube', 'hbo', 'x'] as const) {
  test(`${platform}: packaged extension translates a source track through its worker`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await expect
        .poll(() => p.downloads.length, 'Source timeline must be downloaded')
        .toBe(platform === 'youtube' ? 1 : 2);
      await expect(p.original, 'Paused uncached captions stay hidden').toBeHidden();
      await p.play();
      await p.pair(source, translation);
      const shown = (await p.frames()).filter((f) => f.original);
      expect(shown.length).toBeGreaterThan(0);
      expect(
        shown.filter((f) => !f.translation || f.translation === '翻译中'),
        'The source never appears before its translation',
      ).toEqual([]);
      expect(p.downloads).toHaveLength(platform === 'youtube' ? 1 : 2);
      await expectOpeningPosts(p);
      for (const post of p.posts)
        expect(post.body).toMatchObject({ model: 'e2e-fixed-model', stream: false });
    });
  });

  test(`${platform}: a late response cannot overwrite a new SPA video`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.play();
        await expect.poll(() => p.posts.length).toBeGreaterThan(0);
        const openingCount = p.posts.length;
        const before = (await p.frames()).length;
        await p.page.evaluate(() => window.fixture.switchVideo('second'));
        await expect.poll(() => p.posts.length).toBe(openingCount + 1);
        expect(p.posts.at(-1)!.inputs.map((i) => i.text)).toEqual([nextSource]);
        await expect(p.original).toBeHidden();
        await p.release(openingCount);
        await p.pair(nextSource, nextTranslation);
        await p.release(0);
        await p.seek(3);
        await p.pair(nextSource, nextTranslation);
        const frames = (await p.frames()).slice(before);
        const visible = frames.filter((f) => f.id === 'second' && f.original);
        expect(visible.length).toBeGreaterThan(0);
        expect(visible.map((f) => [f.original, f.translation])).toEqual(
          visible.map(() => [nextSource, nextTranslation]),
        );
        const current = frames.findIndex(
          (f) => f.id === 'second' && f.translation === nextTranslation,
        );
        expect(current).toBeGreaterThanOrEqual(0);
        expect(frames.slice(current).some((f) => f.translation === translation)).toBe(false);
      },
      { hold: true },
    );
  });

  test(`${platform}: source and selected tracks change without consuming website translations`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await p.pair(source, translation);
      await p.page.evaluate(() => window.fixture.select('en', 'asr'));
      await p.pair(asrSource, asrTranslation);
      await p.page.evaluate(() => window.fixture.select('zh-CN'));
      await p.pair(source, translation);
      expect(
        p.downloads.some(
          (r) => new URL(r.url).searchParams.has('tlang') || r.url.includes('zh-CN'),
        ),
      ).toBe(false);
      await p.settings({ sourceLanguage: 'zh-TW' });
      await p.page.evaluate(() => window.fixture.select('zh-TW'));
      await p.pair(traditionalSource, traditionalTranslation);
      if (platform !== 'youtube') {
        await p.page.evaluate(() => window.fixture.select(null));
        await expect(p.original).toBeHidden();
        await expect(p.translated).toBeHidden();
        await p.page.evaluate(() => window.fixture.select('zh-TW'));
        await p.pair(traditionalSource, traditionalTranslation);
      }
      expect(p.downloads.some((r) => r.url.includes('zh-TW'))).toBe(true);
    });
  });

  test(`${platform}: fullscreen, disable and extension reload restore native captions`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await p.pair(source, translation);
      await p.pause();
      await p.page.evaluate(() => window.fixture.native('Native caption'));
      await expectNativeHidden(p, true);
      await p.page.getByRole('button', { name: 'Fullscreen fixture' }).click();
      await expect
        .poll(() => p.page.evaluate(() => document.fullscreenElement?.localName))
        .toBe(platform === 'youtube' ? 'html' : 'div');
      const video = (await p.page.locator('video').boundingBox())!;
      const viewport = await p.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      expect(video).toEqual({ x: 0, y: 0, ...viewport });
      const placement = await p.page.evaluate(async () => {
        const misplaced: string[] = [];
        let shown = 0;
        const end = performance.now() + 1000;
        while (performance.now() < end) {
          await new Promise(requestAnimationFrame);
          const area = document.querySelector('video')!.getBoundingClientRect();
          const host = document.querySelector('[data-subline-overlay]');
          for (const line of host?.shadowRoot?.querySelectorAll<HTMLElement>('.line') ?? []) {
            if (line.hidden) continue;
            shown++;
            const box = line.getBoundingClientRect();
            if (
              box.left < area.left ||
              box.right > area.right ||
              box.top < area.top + area.height / 2 ||
              box.bottom > area.bottom
            )
              misplaced.push(`${line.className} at ${Math.round(box.top)}`);
          }
        }
        return { shown, misplaced: [...new Set(misplaced)] };
      });
      expect(placement.shown).toBeGreaterThan(0);
      expect(placement.misplaced, 'Fullscreen captions stay in the lower video area').toEqual([]);
      await p.pair(source, translation);
      await p.page.evaluate(() => document.exitFullscreen());
      await p.settings({ enabled: false });
      await expect(p.overlay).toHaveCount(0);
      await expectNativeHidden(p, false);
      await p.settings({ enabled: true });
      await expect(p.overlay).toHaveCount(1);
      await expectNativeHidden(p, true);
      await p.settingsPage.evaluate(() => {
        setTimeout(() => chrome.runtime.reload());
      });
      await expect(p.overlay).toHaveCount(0);
      await expectNativeHidden(p, false);
      p.settingsPage = await p.context.newPage();
      await expect(async () => {
        await p.settingsPage.goto(`chrome-extension://${p.extensionId}/popup.html`);
      }).toPass({ timeout: 8000 });
      await expect
        .poll(() =>
          p.settingsPage.evaluate(
            async () => (await chrome.runtime.sendMessage({ type: 'settings' })).data.configured,
          ),
        )
        .toBe(true);
      await p.page.reload();
      await p.play();
      await p.pair(source, translation);
    });
  });
}

for (const platform of ['hbo', 'x'] as const) {
  test(`${platform}: website captions read before the timeline loads never show untranslated`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.page.evaluate((text) => window.fixture.native(text), source);
        await p.play();
        await expect.poll(() => p.downloads.length, 'Manifest requested and held').toBe(1);
        await p.page.waitForTimeout(1000);
        expect((await p.frames()).filter((f) => f.original)).toEqual([]);
        expect(p.posts).toEqual([]);
        await expectNativeHidden(p, true);
        p.releaseTimeline();
        await p.pair(source, translation);
        expect(
          (await p.frames()).filter(
            (f) => f.original && (!f.translation || f.translation === '翻译中'),
          ),
          'The source never appears before its translation',
        ).toEqual([]);
      },
      { holdTimeline: true },
    );
  });
}
