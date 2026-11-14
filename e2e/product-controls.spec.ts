import { expect, test } from '@playwright/test';
import { source, translation, withPlayer } from './harness';

for (const platform of ['youtube', 'x'] as const) {
  test(`${platform}: popup follows captions, quick controls, and active tabs without reopening`, async ({}, info) => {
    await withPlayer(platform, info, async (p) => {
      await p.play();
      await p.pair(source, translation);
      await p.pause();
      await p.settingsPage.reload();
      const status = p.settingsPage.getByRole('status', { name: 'Page status' });
      await expect(status).toHaveText('Showing bilingual subtitles');
      await expect(
        p.settingsPage.getByRole('button', { name: 'Settings', exact: true }),
      ).toHaveText('Settings');
      await expect(p.settingsPage.locator('.popup-model')).toBeHidden();
      await expect(p.settingsPage.locator('.popup-usage')).toBeHidden();
      await p.settingsPage
        .locator('.popup')
        .screenshot({ path: `.artifacts/product-feedback/popup-${platform}-after.png` });
      await p.settingsPage.getByText('Model and usage', { exact: true }).click();
      await expect(p.settingsPage.locator('.popup-model-id')).toHaveText('e2e-fixed-model');
      await expect(p.settingsPage.locator('.popup-usage')).toBeVisible();
      const translationOnly = p.settingsPage.getByRole('checkbox', {
        name: 'Show translation only',
      });
      const enabled = p.settingsPage.getByRole('switch', { name: 'Enable bilingual subtitles' });
      await translationOnly.click();
      await expect(translationOnly).toBeChecked();
      await expect(p.original).toBeHidden();
      await expect(p.translated).toHaveText(translation);
      await expect(status).toHaveText('Showing translated subtitles');
      await enabled.click();
      await expect(p.overlay).toHaveCount(0);
      await expect(status).toHaveText('Subtitles are off');
      await enabled.click();
      await expect(p.translated).toHaveText(translation);
      await expect(status).toHaveText('Showing translated subtitles');
      await translationOnly.click();
      await expect(translationOnly).not.toBeChecked();
      await p.pair(source, translation);
      await expect(status).toHaveText('Showing bilingual subtitles');
      const elsewhere = await p.context.newPage();
      await elsewhere.goto('https://example.org/');
      await expect(status).toHaveText('Subtitles are not supported on this page');
      await p.page.bringToFront();
      await expect(status).toHaveText('Showing bilingual subtitles');
      await elsewhere.close();
      const posts = p.posts.length;
      await p.seek(20);
      await expect(status).toHaveText('Waiting for captions');
      expect(p.posts).toHaveLength(posts);
      await p.page.goto('https://example.org/');
      await expect(status).toHaveText('Subtitles are not supported on this page');
      await p.page.goto(p.url);
      await p.pair(source, translation);
      await expect(status).toHaveText('Showing bilingual subtitles');
    });
  });
}

test('settings: connection results describe real tests independently of saving', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    let finish!: () => void;
    let failed = false;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await p.context.route(
      'https://www.youtube.com/__e2e_provider__/v1/chat/completions',
      async (route) => {
        await pending;
        await route.fulfill(
          failed
            ? { status: 503, json: { error: { message: 'Provider unavailable' } } }
            : { json: { choices: [{ message: { content: '世界充满了美妙的事物。' } }] } },
        );
      },
    );
    await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html`);
    const status = p.settingsPage.getByRole('status', { name: 'Connection test', exact: true });
    await expect(status).toHaveText('Not tested this session');
    await expect(p.settingsPage.getByRole('button', { name: 'Settings saved' })).toBeDisabled();
    await p.settingsPage.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(status).toHaveText('Testing…');
    finish();
    await expect(status).toHaveText('Test passed');
    await p.settingsPage.locator('#provider').selectOption('microsoft');
    await p.settingsPage.locator('#provider').selectOption('openai');
    await expect(status).toHaveText('Not tested this session');
    failed = true;
    await p.settingsPage.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(status).toHaveText('Test failed');
    await p.settingsPage.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(p.settingsPage.locator('.settings-alert')).toBeHidden();
    await p.settingsPage.locator('.workspace').evaluate((node) => node.scrollTo({ top: 0 }));
    await p.settingsPage.screenshot({
      path: '.artifacts/product-feedback/settings-after.png',
      fullPage: true,
    });
    await p.settingsPage.locator('#base-url').fill('https://www.youtube.com/other/v1');
    await expect(status).toHaveText('Not tested this session');
    await expect(p.settingsPage.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    p.settingsPage.once('dialog', (dialog) => dialog.accept());
    await p.settingsPage.reload();
    await expect(status).toHaveText('Not tested this session');
    await expect(p.settingsPage.getByRole('button', { name: 'Settings saved' })).toBeDisabled();
  });
});

test('settings: narrow style preview keeps maximum-size captions visible and restores focus', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    await p.settingsPage.setViewportSize({ width: 360, height: 800 });
    await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html`);
    await p.settingsPage.getByRole('button', { name: 'Subtitle style', exact: true }).click();
    await p.settingsPage.locator('#original-size').fill('48');
    await p.settingsPage.locator('#translation-size').fill('48');
    await p.settingsPage.locator('#subtitle-gap').fill('24');
    await expect(p.settingsPage.getByRole('button', { name: 'Save changes' })).toBeInViewport();
    const captionsFit = (selector: string) =>
      p.settingsPage.locator(selector).evaluate((scene) => {
        const outer = scene.getBoundingClientRect();
        return [...scene.querySelectorAll('.sample-subtitles > div')].every((caption) => {
          const box = caption.getBoundingClientRect();
          return (
            box.top >= outer.top &&
            box.bottom <= outer.bottom &&
            box.left >= outer.left &&
            box.right <= outer.right
          );
        });
      });
    await expect.poll(() => captionsFit('.preview-panel .preview-scene')).toBe(true);
    await p.settingsPage.getByRole('button', { name: 'Expand subtitle preview' }).click();
    await expect(p.settingsPage.getByRole('dialog')).toBeVisible();
    await expect.poll(() => captionsFit('.preview-dialog .preview-scene')).toBe(true);
    await p.settingsPage.getByRole('button', { name: 'Next sample' }).last().click();
    await expect.poll(() => captionsFit('.preview-dialog .preview-scene')).toBe(true);
    await p.settingsPage.keyboard.press('Escape');
    await expect(p.settingsPage.getByRole('dialog')).toHaveCount(0);
    await expect(
      p.settingsPage.getByRole('button', { name: 'Expand subtitle preview' }),
    ).toBeFocused();
  });
});

test('settings: selected colors show keyboard focus and sliders accept clicks above the track', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html`);
    await p.settingsPage.getByRole('button', { name: 'Subtitle style', exact: true }).click();
    const selected = p.settingsPage.locator('.color-presets button[aria-pressed="true"]').first();
    const outline = () =>
      selected.evaluate((button) => {
        const style = getComputedStyle(button);
        return [style.outlineColor, style.outlineWidth, style.outlineOffset];
      });
    const selection = await outline();
    await p.settingsPage.keyboard.press('Tab');
    await selected.focus();
    expect(await selected.evaluate((button) => button.matches(':focus-visible'))).toBe(true);
    expect(await outline()).not.toEqual(selection);
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    const slider = p.settingsPage.locator('#original-size');
    const box = (await slider.boundingBox())!;
    await slider.click({ position: { x: box.width * 0.75, y: box.height / 2 - 10 } });
    expect(Number(await slider.inputValue())).toBeGreaterThan(24);
    await p.settingsPage.locator('.save-button').focus();
    await p.settingsPage.keyboard.press('Tab');
    await expect(
      p.settingsPage.getByRole('button', { name: 'Expand subtitle preview' }),
    ).toBeFocused();
  });
});
