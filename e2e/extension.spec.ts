import { expect, test } from '@playwright/test';
import { maxInFlightRequests } from '../src/shared/limits';
import { providerTimeoutMs } from '../src/shared/provider/transport';
import { longCaption, longCaptionParts, longTranslations } from '../tests/fixtures/long-caption';
import {
  apiKey,
  asrSource,
  asrTranslation,
  denseCue,
  draftPrefix,
  elsewhereUrl,
  traditionalSource,
  traditionalTranslation,
  gardenSource,
  nextSource,
  nextTranslation,
  source,
  thirdSource,
  thirdTranslation,
  translation,
  withPlayer,
  type Player,
} from './harness';

async function expectNativeHidden(p: Player, hidden: boolean) {
  if (p.platform === 'x') {
    const video = expect(p.page.locator('video'));
    await (hidden ? video : video.not).toHaveClass(/subline-native/);
    return;
  }
  await expect(p.page.locator('#native')).toHaveCSS('opacity', hidden ? '0' : '1');
  if (!hidden) await expect(p.page.locator('#native')).toBeVisible();
}

const errorsShown = async (p: Player) =>
  [...new Set((await p.frames()).map((f) => f.translation))].filter((t) =>
    t.startsWith('Subline：'),
  );

const openingInputs = [[{ id: 0, text: source }]];

async function expectOpeningPosts(p: Player) {
  await expect.poll(() => p.posts.map((post) => post.inputs)).toEqual(openingInputs);
}

async function expectStored(p: Player, text: string) {
  await expect
    .poll(() =>
      p.settingsPage.evaluate(async (caption) => {
        const stored = await chrome.storage.session.get(null);
        return Object.keys(stored).some((key) => key.includes(caption));
      }, text),
    )
    .toBe(true);
}

async function preloadNext(p: Player) {
  await p.seek(24);
  await expectStored(p, nextSource);
}

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

  test(`${platform}: a late response cannot overwrite a new SPA video`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.play();
        await expect.poll(() => p.posts.length).toBeGreaterThan(0);
        const openingCount = p.posts.length;
        await p.page.evaluate(() => window.fixture.switchVideo('second'));
        await expect.poll(() => p.posts.length).toBe(openingCount + 1);
        expect(p.posts.at(-1)!.inputs.map((i) => i.text)).toEqual([nextSource]);
        await expect(p.original).toBeHidden();
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

  test(`${platform}: compatibility retry uses actual worker HTTP and finishes`, async ({}, info) => {
    await withPlayer(
      platform,
      info,
      async (p) => {
        await p.play();
        await p.pair(source, translation);
        const rejected = p.posts.filter((post) => post.status === 400);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].body).toHaveProperty('response_format');
        const retry = p.posts.filter(
          (post) =>
            post !== rejected[0] &&
            post.inputs.length === rejected[0].inputs.length &&
            post.inputs.every((input, index) => input.text === rejected[0].inputs[index]?.text),
        );
        expect(retry).toHaveLength(1);
        expect(retry[0].body).not.toHaveProperty('response_format');
        expect(retry[0].inputs).toEqual(rejected[0].inputs);
        expect(p.posts).toHaveLength(2);
      },
      { retry: true },
    );
  });

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
      await expect(p.translated).toHaveText('Subline：API Key 无效或已过期。');
      await expect(p.translated).toHaveClass(/error/);
      await expect(p.original).toHaveText(source);
      expect(p.posts.map((post) => post.status)).toContain(401);
      expect(p.posts.every((post) => post.status === 401)).toBe(true);
      await p.settings({ apiKey });
      await p.pair(source, translation);
      await expect(p.translated).not.toHaveClass(/error/);
      expect(p.posts.at(-1)!.status).toBe(200);
      expect(await errorsShown(p)).toEqual(['Subline：API Key 无效或已过期。']);
    });
  });

  test(`${platform}: a transient Provider failure recovers after backoff without extra requests`, async ({}, info) => {
    test.setTimeout(60_000);
    await withPlayer(
      platform,
      info,
      async (p) => {
        await expect.poll(() => p.downloads.length).toBeGreaterThan(0);
        const downloads = p.downloads.length;
        await p.page.evaluate(() => window.fixture.switchVideo('second'));
        await expect.poll(() => p.downloads.length).toBeGreaterThan(downloads);
        await p.play();
        await expect(p.translated).toHaveText('Subline：接口返回 HTTP 503，请稍后重试。');
        await expect(p.original, 'A failed caption shows its source').toHaveText(nextSource);
        const failedAt = Date.now();
        expect(p.posts.map((post) => post.status)).toEqual([503]);
        await expect(p.translated).toHaveText(nextTranslation, { timeout: 25_000 });
        expect(Date.now() - failedAt).toBeGreaterThan(14_000);
        expect(p.posts.map((post) => post.status)).toEqual([503, 200]);
        await p.pair(nextSource, nextTranslation);
        expect(await errorsShown(p)).toEqual(['Subline：接口返回 HTTP 503，请稍后重试。']);
      },
      { unavailable: 1 },
    );
  });

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

  test(`${platform}: a cached translation replaces the next caption without 翻译中`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await expect.poll(() => p.posts.length).toBeGreaterThan(0);
      await p.pair(source, translation);
      await preloadNext(p);
      const openingCount = p.posts.length;
      await p.seek(27);
      const before = (await p.frames()).length;
      await p.pair(nextSource, nextTranslation);
      expect(
        (await p.frames()).slice(before).filter((f) => f.translation === '翻译中'),
        'A translation the worker already has never shows 翻译中 first',
      ).toEqual([]);
      expect(p.posts).toHaveLength(openingCount);
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

test('youtube: a stalled opening batch times out without a retry and the next batch still appears', async ({}, info) => {
  test.setTimeout(providerTimeoutMs + 30_000);
  await withPlayer(
    'youtube',
    info,
    async (p) => {
      await p.play();
      await expect.poll(() => p.posts.length).toBeGreaterThan(0);
      expect(p.posts[0].inputs.map((input) => input.text)).toEqual([denseCue(0).text]);
      await expect(p.translated).toHaveText('翻译中');
      await p.pause();
      expect(
        await p.page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime),
      ).toBeLessThan(denseCue(0).end);
      await p.page.waitForTimeout(providerTimeoutMs + 1500);
      const first = p.posts[0].inputs.map((input) => input.text).join('\n');
      expect(
        p.posts.filter((post) => post.inputs.map((input) => input.text).join('\n') === first),
      ).toHaveLength(1);
      await expect(p.translated).toHaveText('接口调用超时');
      const later = denseCue(4);
      await p.seek(later.start + 0.2);
      await p.play();
      await p.pair(later.text, later.translation);
      await p.posts[0].route.abort('timedout').catch(() => undefined);
    },
    { dense: true, stallFirst: true },
  );
});

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
