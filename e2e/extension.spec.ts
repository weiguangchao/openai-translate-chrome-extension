import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

const extensionPath = path.resolve(process.env.SUBLINE_EXTENSION_PATH ?? 'dist');
const providerUrl = 'https://www.youtube.com/__e2e_provider__/v1/chat/completions';
const scenarios = [
  {
    platform: 'youtube',
    url: 'https://www.youtube.com/watch?v=e2e-youtube',
    source: 'The moon is bright tonight.',
    translation: '今晚的月亮很明亮。',
    resources: ['https://www.youtube.com/api/timedtext?v=e2e-youtube&lang=en&fmt=json3'],
  },
  {
    platform: 'hbo',
    url: 'https://play.hbomax.com/video/watch/e2e-hbo',
    source: 'We will meet at the station.',
    translation: '我们将在车站见面。',
    resources: [
      'https://play.hbomax.com/e2e/manifest.mpd',
      'https://play.hbomax.com/e2e/english.vtt',
    ],
  },
];

for (const scenario of scenarios) {
  test(`${scenario.platform}: packaged extension translates a source track through its worker`, async ({}, testInfo) => {
    const profile = await mkdtemp(path.join(tmpdir(), 'subline-e2e-'));
    const requests: { url: string; method: string; worker: string | null; body: unknown }[] = [];
    const unexpected: string[] = [];
    const errors: string[] = [];
    let context: BrowserContext | undefined;
    try {
      const manifest = JSON.parse(
        await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'),
      );
      expect(manifest).toEqual(JSON.parse(await readFile('public/manifest.json', 'utf8')));
      const files = (await readdir(extensionPath, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name))
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
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const extensionId = new URL(worker.url()).host;
      expect(worker.url()).toBe(`chrome-extension://${extensionId}/background.js`);
      await testInfo.attach('build.json', {
        body: JSON.stringify(
          {
            sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            node: process.version,
            playwright: JSON.parse(
              await readFile('node_modules/@playwright/test/package.json', 'utf8'),
            ).version,
            browser: context.browser()?.version(),
            extensionId,
            extensionPath,
            buildSha256: digest.digest('hex'),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      context.on('weberror', (error) => errors.push(error.error().message));
      context.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();
        if (url.startsWith(`chrome-extension://${extensionId}/`)) return route.continue();
        const worker = request.serviceWorker()?.url() ?? null;
        requests.push({ url, method: request.method(), worker, body: request.postDataJSON() });
        const fulfill = (file: string, contentType: string) =>
          route.fulfill({ path: path.resolve('e2e/fixtures', file), contentType });
        if (url === scenario.url && request.isNavigationRequest())
          return fulfill('player.html', 'text/html');
        if (url === scenario.resources[0] && scenario.platform === 'youtube')
          return fulfill('youtube.json', 'application/json');
        if (url === scenario.resources[0] && scenario.platform === 'hbo')
          return fulfill('hbo.mpd', 'application/dash+xml');
        if (url === scenario.resources[1] && scenario.platform === 'hbo')
          return fulfill('hbo.vtt', 'text/vtt');
        if (url === providerUrl && request.method() === 'POST' && worker) {
          return route.fulfill({
            json: {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      results: [{ id: 0, parts: [{ translation: scenario.translation }] }],
                    }),
                  },
                },
              ],
            },
          });
        }
        unexpected.push(`${request.method()} ${url}`);
        await route.abort('blockedbyclient');
      });
      await worker.evaluate(async () => {
        await chrome.storage.local.set({
          'subline.settings.v1': {
            enabled: true,
            youtube: true,
            hbo: true,
            baseUrl: 'https://www.youtube.com/__e2e_provider__/v1',
            apiKey: 'e2e-fake-key',
            model: 'e2e-fixed-model',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
          },
        });
      });
      const settingsPage = await context.newPage();
      await settingsPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect
        .poll(() =>
          settingsPage.evaluate(async () => {
            const reply = await chrome.runtime.sendMessage({ type: 'settings' });
            return reply?.data?.configured;
          }),
        )
        .toBe(true);
      await settingsPage.close();
      const page = await context.newPage();
      await page.goto(scenario.url);
      const overlay = page.locator('[data-subline-overlay]');
      await expect(
        overlay.locator('.original'),
        'Source timeline must reach the overlay',
      ).toHaveText(scenario.source);
      await page.getByRole('button', { name: 'Play fixture' }).click();
      await expect(overlay.locator('.translation')).toHaveText(scenario.translation);
      await expect(overlay).toHaveCount(1);
      await expect(overlay.locator('.original')).toBeVisible();
      await expect(overlay.locator('.translation')).toBeVisible();
      await expect
        .poll(() =>
          page.locator('video').evaluate((video: HTMLVideoElement) => ({
            paused: video.paused,
            ready: video.readyState >= 2,
            playing: video.currentTime > 0,
          })),
        )
        .toEqual({ paused: false, ready: true, playing: true });
      for (const url of scenario.resources)
        expect(requests.filter((request) => request.url === url && !request.worker)).toHaveLength(
          1,
        );
      const posts = requests.filter((request) => request.url === providerUrl);
      expect(posts).toHaveLength(1);
      expect(posts[0].worker).toBe(worker.url());
      expect(posts[0].body).toMatchObject({ model: 'e2e-fixed-model', stream: false });
      const body = posts[0].body as { messages: { role: string; content: string }[] };
      expect(JSON.parse(body.messages.find((message) => message.role === 'user')!.content)).toEqual(
        [{ id: 0, text: scenario.source, needsSplit: false }],
      );
      expect(unexpected, 'Every HTTP request must be handled by an explicit fixture').toEqual([]);
      expect(errors, 'No browser or extension errors').toEqual([]);
    } finally {
      await testInfo.attach('network.json', {
        body: JSON.stringify({ requests, unexpected, errors }, null, 2),
        contentType: 'application/json',
      });
      if (context) {
        if (testInfo.status !== testInfo.expectedStatus) {
          const page = context.pages().find((page) => page.url() === scenario.url);
          if (page)
            await testInfo.attach('failure.png', {
              body: await page.screenshot(),
              contentType: 'image/png',
            });
          const trace = testInfo.outputPath('trace.zip');
          await context.tracing.stop({ path: trace });
          await testInfo.attach('trace', { path: trace, contentType: 'application/zip' });
        } else await context.tracing.stop();
        await context.close();
      }
      await rm(profile, { recursive: true, force: true });
    }
  });
}
