import { expect, test } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { denseCue, source, translation, withPlayer } from './harness';

test(
  'malformed stored styles fall back to defaults in the running extension',
  { tag: '@local' },
  async ({}, info) => {
    await withPlayer('youtube', info, async (p) => {
      await p.settingsPage.evaluate(async () => {
        const key = 'subline.settings.v1';
        const current = (await chrome.storage.local.get(key))[key];
        await chrome.storage.local.set({
          [key]: {
            ...current,
            subtitleGap: 17,
            original: { color: ['#123456'] },
            translation: { color: { toString: null } },
          },
        });
      });
      await expect
        .poll(() => p.settingsPage.evaluate(() => chrome.runtime.sendMessage({ type: 'settings' })))
        .toMatchObject({
          ok: true,
          data: {
            subtitleGap: 17,
            original: DEFAULT_SETTINGS.original,
            translation: DEFAULT_SETTINGS.translation,
          },
        });
      await p.play();
      await p.pair(source, translation);
      await expect(p.translated).toHaveCSS('color', 'rgb(255, 255, 255)');
      await info.attach('valid-subtitles-with-bad-storage.png', {
        body: await p.page.screenshot(),
        contentType: 'image/png',
      });
    });
  },
);

test(
  'playback resumes after dropped control messages in the content script',
  { tag: '@local' },
  async ({}, info) => {
    await withPlayer(
      'youtube',
      info,
      async (p) => {
        await p.play();
        await p.pair(denseCue(0).text, denseCue(0).translation);
        const session = await p.context.newCDPSession(p.page);
        const contexts: { id: number; origin: string }[] = [];
        session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
        await session.send('Runtime.enable');
        const world = contexts.find(
          (context) => context.origin === `chrome-extension://${p.extensionId}`,
        );
        expect(world).toBeDefined();
        await session.send('Runtime.evaluate', {
          contextId: world!.id,
          expression: `(() => {
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          globalThis.controlAttempts = { 'prefetch-pause': 0, 'prefetch-resume': 0 };
          chrome.runtime.sendMessage = (message, ...args) => {
            if (message.type in globalThis.controlAttempts && ++globalThis.controlAttempts[message.type] === 1)
              return Promise.reject(new Error('Receiving end does not exist.'));
            return send(message, ...args);
          };
        })()`,
        });
        const attempts = async () =>
          (
            await session.send('Runtime.evaluate', {
              contextId: world!.id,
              expression: 'globalThis.controlAttempts',
              returnByValue: true,
            })
          ).result.value;
        await p.pause();
        await expect.poll(attempts).toEqual({ 'prefetch-pause': 2, 'prefetch-resume': 0 });
        const sent = p.posts.length;
        await p.seek(40.2);
        await p.page.waitForTimeout(1000);
        expect(p.posts).toHaveLength(sent);
        await p.play();
        await expect.poll(attempts).toEqual({ 'prefetch-pause': 2, 'prefetch-resume': 2 });
        await p.pair(denseCue(10).text, denseCue(10).translation);
        await info.attach('resumed-after-lost-control.png', {
          body: await p.page.screenshot(),
          contentType: 'image/png',
        });
        await session.detach();
      },
      { dense: true },
    );
  },
);
