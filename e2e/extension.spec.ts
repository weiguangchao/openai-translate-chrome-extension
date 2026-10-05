import { expect, test } from '@playwright/test';
import { longCaption, longCaptionParts, longTranslations } from '../tests/fixtures/long-caption';
import {
  apiKey,
  asrSource,
  asrTranslation,
  draftPrefix,
  frenchSource,
  frenchTranslation,
  nextSource,
  nextTranslation,
  source,
  translation,
  withPlayer,
} from './harness';

const shownError = (cause: string) =>
  new RegExp(`^Subline：(${cause}|接口暂不可用，稍后将自动重试。)$`);

for (const platform of ['youtube', 'hbo'] as const) {
  test(`${platform}: packaged extension translates a source track through its worker`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await expect(p.original, 'Source timeline must reach the overlay').toHaveText(source);
      await p.play();
      await p.pair(source, translation);
      expect(p.downloads).toHaveLength(platform === 'youtube' ? 1 : 2);
      expect(p.posts).toHaveLength(1);
      expect(p.posts[0].body).toMatchObject({ model: 'e2e-fixed-model', stream: false });
      expect(p.posts[0].inputs).toEqual([
        { id: 0, text: source, needsSplit: false },
        { id: 1, text: nextSource, needsSplit: false },
        { id: 2, text: 'The garden is quiet.', needsSplit: false },
      ]);
    });
  });

  test(`${platform}: delayed split stays hidden and style changes preserve in-flight work`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.seek(40);
        await p.play();
        await expect.poll(() => p.posts.length).toBe(1);
        expect(p.posts[0].inputs).toMatchObject([{ id: 0, text: longCaption, needsSplit: true }]);
        await p.pause();
        const host = await p.overlay.elementHandle();
        const downloads = p.downloads.length;
        await p.settings({ original: { color: '#FFFFFF', size: 32 } });
        await expect(p.original).toHaveCSS('font-size', '32px');
        expect(
          await host!.evaluate((node) => node === document.querySelector('[data-subline-overlay]')),
        ).toBe(true);
        expect(p.posts).toHaveLength(1);
        expect(p.downloads).toHaveLength(downloads);
        await expect(p.original).toBeHidden();
        await p.release(0);
        await p.pair(longCaptionParts[1], longTranslations[1]);
        expect(p.posts).toHaveLength(1);
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
        await expect.poll(() => p.posts.length).toBe(1);
        await p.pause();
        await p.release(0);
        await p.pair(source, translation);
        await p.seek(35);
        await p.pair(nextSource, nextTranslation);
        await p.seek(2);
        await p.pair(source, translation);
        await p.play();
        await expect
          .poll(() => p.page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
          .toBeGreaterThan(3.5);
        expect(p.posts).toHaveLength(1);
        expect(p.downloads).toHaveLength(platform === 'youtube' ? 1 : 2);
        await p.pause();
        await p.page.evaluate(() => window.fixture.switchVideo('second'));
        await expect(p.original).toHaveText(nextSource);
        await p.pair(nextSource, nextTranslation);
        expect(p.posts).toHaveLength(1);
      },
      { hold: true },
    );
  });

  test(`${platform}: a late response cannot overwrite a new SPA video`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.play();
        await expect.poll(() => p.posts.length).toBe(1);
        await p.page.evaluate(() => window.fixture.switchVideo('second'));
        await expect(p.original).toHaveText(nextSource);
        await expect.poll(() => p.posts.length).toBe(2);
        expect(p.posts[1].inputs.map((i) => i.text)).toEqual([nextSource]);
        await p.release(1);
        await p.pair(nextSource, nextTranslation);
        await p.release(0);
        await p.seek(3);
        await p.pair(nextSource, nextTranslation);
        const frames = await p.frames();
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
      await p.settings({ sourceLanguage: 'fr' });
      await p.page.evaluate(() => window.fixture.select('fr'));
      await p.pair(frenchSource, frenchTranslation);
      if (platform === 'hbo') {
        await p.page.evaluate(() => window.fixture.select(null));
        await expect(p.original).toBeHidden();
        await expect(p.translated).toBeHidden();
        await p.page.evaluate(() => window.fixture.select('fr'));
        await p.pair(frenchSource, frenchTranslation);
      }
      expect(p.downloads.some((r) => r.url.includes('fr'))).toBe(true);
    });
  });

  test(`${platform}: paused uncached content waits for resume`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await expect(p.original).toHaveText(source);
      expect(p.posts).toHaveLength(0);
      await p.page.evaluate(() => window.fixture.switchVideo('second'));
      await expect(p.original).toHaveText(nextSource);
      await p.page.waitForTimeout(1500);
      expect(p.posts).toHaveLength(0);
      await p.play();
      await p.pair(nextSource, nextTranslation);
      expect(p.posts).toHaveLength(1);
    });
  });

  test(`${platform}: fullscreen, disable and extension reload restore native captions`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await p.pair(source, translation);
      await p.pause();
      await p.page.evaluate(() => window.fixture.native('Native caption'));
      await expect(p.page.locator('#native')).toHaveCSS('opacity', '0');
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
      await expect(p.page.locator('#native')).toHaveCSS('opacity', '1');
      await expect(p.page.locator('#native')).toBeVisible();
      await p.settings({ enabled: true });
      await expect(p.overlay).toHaveCount(1);
      await expect(p.page.locator('#native')).toHaveCSS('opacity', '0');
      await p.settingsPage.evaluate(() => {
        setTimeout(() => chrome.runtime.reload());
      });
      await expect(p.overlay).toHaveCount(0);
      await expect(p.page.locator('#native')).toHaveCSS('opacity', '1');
      await expect(p.page.locator('#native')).toBeVisible();
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

  test(`${platform}: compatibility retry uses actual worker HTTP and finishes`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.play();
        await p.pair(source, translation);
        expect(p.posts).toHaveLength(2);
        expect(p.posts[0].body).toHaveProperty('response_format');
        expect(p.posts[1].body).not.toHaveProperty('response_format');
        expect(p.posts[1].inputs).toEqual(p.posts[0].inputs);
      },
      { retry: true },
    );
  });

  test(`${platform}: a draft before the final JSON never reaches the overlay or cache`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.play();
        await p.pair(source, translation);
        await p.pause();
        await p.seek(35);
        await p.pair(nextSource, nextTranslation);
        await p.seek(2);
        await p.pair(source, translation);
        expect(p.posts).toHaveLength(1);
        const frames = await p.frames();
        expect(frames.filter((f) => f.translation.startsWith(draftPrefix))).toEqual([]);
      },
      { draft: true },
    );
  });

  test(`${platform}: an invalid key shows a safe error and recovers once fixed`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.settings({ apiKey: 'e2e-invalid-key' });
      await p.play();
      await expect(p.translated).toHaveText(shownError('API Key 无效或已过期。'));
      await expect(p.translated).toHaveClass(/error/);
      await expect(p.original).toHaveText(source);
      expect(p.posts.map((post) => post.status)).toContain(401);
      expect(p.posts.every((post) => post.status === 401)).toBe(true);
      await p.settings({ apiKey });
      await p.pair(source, translation);
      await expect(p.translated).not.toHaveClass(/error/);
      expect(p.posts.at(-1)!.status).toBe(200);
      const frames = await p.frames();
      expect(frames.filter((f) => /e2e-invalid-key|Incorrect API key/.test(f.translation))).toEqual(
        [],
      );
    });
  });

  test(`${platform}: a transient Provider failure recovers after backoff without extra requests`, async ({}, info) => {
    test.setTimeout(60_000);
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.page.evaluate(() => window.fixture.switchVideo('second'));
        await expect(p.original).toHaveText(nextSource);
        await p.play();
        await expect(p.translated).toHaveText(shownError('接口返回 HTTP 503，请稍后重试。'));
        const failedAt = Date.now();
        expect(p.posts.map((post) => post.status)).toEqual([503]);
        await expect(p.translated).toHaveText(nextTranslation, { timeout: 25_000 });
        expect(Date.now() - failedAt).toBeGreaterThan(14_000);
        expect(p.posts.map((post) => post.status)).toEqual([503, 200]);
        await p.pair(nextSource, nextTranslation);
      },
      { unavailable: 1 },
    );
  });

  test(`${platform}: a stopped worker restarts on new page demand`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await p.pair(source, translation);
      await p.pause();
      const worker = await p.watchWorker();
      await worker.stop();
      await expect.poll(worker.status).toBe('stopped');
      await p.page.evaluate(() => window.fixture.switchVideo('second'));
      await p.play();
      await p.pair(nextSource, nextTranslation);
      await expect.poll(worker.status).toBe('running');
      expect(p.posts).toHaveLength(2);
      await info.attach('worker.json', {
        body: JSON.stringify(worker.history),
        contentType: 'application/json',
      });
      await worker.detach();
    });
  });
}
