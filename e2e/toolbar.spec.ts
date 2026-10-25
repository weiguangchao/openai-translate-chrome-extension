import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { withPlayer } from './harness';

for (const { platform, size, width } of [
  { platform: 'youtube', size: 18.333, width: 36 },
  { platform: 'x', size: 20, width: 40 },
  { platform: 'hbo', size: 20, width: 40 },
] as const) {
  test(`${platform}: the player logo follows the native toolbar and its lifecycle`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      const fixture = await readFile('e2e/fixtures/toolbar.html', 'utf8');
      await p.page.evaluate(
        ({ fixture, platform }) => {
          const controls = document.createElement('div');
          controls.innerHTML = fixture;
          document.body.append(controls);
          const template = document.querySelector<HTMLTemplateElement>(`#${platform}-toolbar`)!;
          document.querySelector('#player')!.append(template.content.cloneNode(true));
        },
        { fixture, platform },
      );
      const player = p.page.locator('#player');
      const logo = player.getByRole('img', { name: 'Subline', exact: true });
      await player.screenshot({ path: info.outputPath('player.png') });
      await expect(logo).toBeVisible();
      await expect(logo).toHaveCount(1);
      await expect
        .poll(() =>
          logo
            .locator('img')
            .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      const measurements = () =>
        logo.evaluate((host) => {
          const native = host.parentElement!.querySelector('button')!;
          const mark = host.shadowRoot!.querySelector('img')!.getBoundingClientRect();
          const slot = host.getBoundingClientRect();
          const button = native.getBoundingClientRect();
          return {
            first: host.parentElement!.firstElementChild === host,
            size: mark.width,
            width: slot.width,
            center: slot.y + slot.height / 2,
            buttonCenter: button.y + button.height / 2,
          };
        });
      const initial = await measurements();
      expect(initial.first).toBe(true);
      expect(initial.size).toBeCloseTo(size, 1);
      expect(initial.width).toBe(width);
      expect(initial.center).toBe(initial.buttonCenter);
      await player.screenshot({ path: info.outputPath('player-ready.png') });
      await p.page.locator('.toolbar button').first().focus();
      await p.page.keyboard.press('Tab');
      await expect(
        player
          .getByRole('button', { name: 'Subtitles', exact: true })
          .or(player.getByRole('button', { name: 'Closed captions', exact: true }))
          .or(player.getByRole('button', { name: 'Audio and subtitles', exact: true })),
      ).toBeFocused();
      await p.page.locator('.toolbar').evaluate((toolbar) => {
        toolbar.querySelector('[data-subline-logo]')?.remove();
        toolbar.replaceWith(toolbar.cloneNode(true));
      });
      await expect(logo).toBeVisible();
      await expect(logo).toHaveCount(1);
      await p.page.locator('.toolbar button').evaluateAll((buttons) => {
        for (const button of buttons) {
          if (button instanceof HTMLElement) {
            button.style.width = '48px';
            button.style.height = '48px';
          }
          const svg = button.querySelector('svg');
          if (svg) {
            svg.style.width = '40px';
            svg.style.height = '32px';
          }
        }
      });
      await expect.poll(async () => (await measurements()).width).toBe(48);
      const resized = await measurements();
      expect(resized.size).toBeGreaterThan(initial.size);
      expect(resized.size).toBeCloseTo(26.667, 1);
      await p.page.getByRole('button', { name: 'Fullscreen fixture' }).click();
      await expect(logo).toBeVisible();
      await p.page.evaluate(() => document.exitFullscreen());
      await p.page.evaluate(() => window.fixture.switchVideo('second'));
      await expect(logo).toBeVisible();
      await expect(logo).toHaveCount(1);
      await p.settings({ enabled: false });
      await expect(logo).toHaveCount(0);
      await p.settings({ enabled: true });
      await expect(logo).toBeVisible();
      await p.page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
      );
      await expect(logo).toHaveCount(0);
      await p.page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
      );
      await expect(logo).toBeVisible();
      await expect(logo).toHaveCount(1);
      await p.page.evaluate(() => document.querySelector('.toolbar')!.remove());
      await expect(logo).toHaveCount(0);
    });
  });
}
