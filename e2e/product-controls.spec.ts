import { expect, test } from '@playwright/test';
import { source, translation, withPlayer } from './harness';

test('x: popup shows the live page state and keeps model details secondary', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    await p.play();
    await p.pair(source, translation);
    await p.pause();
    await p.settingsPage.reload();
    const status = p.settingsPage.getByRole('status', { name: 'Page status' });
    await expect(status).toHaveText('Showing bilingual subtitles');
    await expect(p.settingsPage.getByRole('button', { name: 'Settings', exact: true })).toHaveText(
      'Settings',
    );
    await expect(p.settingsPage.locator('.popup-model')).toBeHidden();
    await expect(p.settingsPage.locator('.popup-usage')).toBeHidden();
    await p.settingsPage
      .locator('.popup')
      .screenshot({ path: '.artifacts/product-feedback/popup-after.png' });
    await p.settingsPage.getByText('Model and usage', { exact: true }).click();
    await expect(p.settingsPage.locator('.popup-model-id')).toHaveText('e2e-fixed-model');
    await expect(p.settingsPage.locator('.popup-usage')).toBeVisible();
    await p.settings({ translationOnly: true });
    await expect(status).toHaveText('Showing translated subtitles');
    await p.settings({ enabled: false });
    await expect(status).toHaveText('Subtitles are off');
    await p.settings({ enabled: true, translationOnly: false });
    await expect(status).toHaveText('Showing bilingual subtitles');
    const posts = p.posts.length;
    await p.seek(20);
    await expect(status).toHaveText('Waiting for captions');
    expect(p.posts).toHaveLength(posts);
    await p.page.goto('https://example.org/');
    await expect(status).toHaveText('Subtitles are not supported on this page');
    await p.page.goto(p.url);
  });
});

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
