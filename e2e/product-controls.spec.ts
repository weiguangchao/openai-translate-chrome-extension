import { expect, test } from '@playwright/test';
import { source, translation, withPlayer } from './harness';
import { STORAGE_KEY } from '../src/shared/settings';

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
      const translationOnly = p.settingsPage.getByRole('radio', {
        name: 'Translation only',
        exact: true,
      });
      const enabled = p.settingsPage.getByRole('switch', { name: 'Enable subtitles' });
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
      await p.settingsPage.getByRole('radio', { name: 'Bilingual', exact: true }).click();
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
    await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html#service`);
    const status = p.settingsPage.getByRole('status', { name: 'Connection test', exact: true });
    await expect(status).toHaveText('Not tested this session');
    await expect(p.settingsPage.getByRole('button', { name: 'Settings saved' })).toBeDisabled();
    await p.settingsPage.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(status).toHaveText('Testing…');
    finish();
    await expect(status).toHaveText('Test passed');
    await p.settingsPage.getByRole('radio', { name: 'Microsoft Translate' }).check();
    await p.settingsPage.getByRole('radio', { name: 'OpenAI' }).check();
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

test('popup: quick saves restore keyboard focus without stealing it from another control', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    const release = await p.settingsPage.evaluateHandle(() => {
      let release!: () => void;
      let gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const write = chrome.storage.local.set.bind(chrome.storage.local);
      Object.defineProperty(chrome.storage.local, 'set', {
        value: async (items: Record<string, unknown>) => {
          await gate;
          return write(items);
        },
      });
      return {
        release: () => release(),
        hold: () => {
          gate = new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      };
    });
    const bilingual = p.settingsPage.getByRole('radio', { name: 'Bilingual', exact: true });
    const only = p.settingsPage.getByRole('radio', { name: 'Translation only', exact: true });
    await bilingual.focus();
    await p.settingsPage.keyboard.press('ArrowRight');
    await expect(only).toBeDisabled();
    await release.evaluate((gate) => gate.release());
    await expect(only).toBeChecked();
    await expect(only).toBeFocused();
    await p.settingsPage.keyboard.press('ArrowLeft');
    await expect(bilingual).toBeChecked();
    await expect(bilingual).toBeFocused();
    const language = p.settingsPage.locator('#popup-target-language');
    await language.focus();
    await language.selectOption('ja');
    await expect(language).toBeEnabled();
    await expect(language).toBeFocused();
    const enabled = p.settingsPage.getByRole('switch', { name: 'Enable subtitles' });
    await enabled.focus();
    await p.settingsPage.keyboard.press('Space');
    await expect(enabled).toBeEnabled();
    await expect(enabled).toBeFocused();
    await expect(enabled).toHaveAttribute('aria-checked', 'false');
    await release.evaluate((gate) => gate.hold());
    await p.settingsPage.keyboard.press('Space');
    await expect(enabled).toBeDisabled();
    const settings = p.settingsPage.getByRole('button', { name: 'Settings', exact: true });
    await settings.focus();
    await release.evaluate((gate) => gate.release());
    await expect(enabled).toBeEnabled();
    await expect(settings).toBeFocused();
    await release.dispose();
  });
});

test('popup: setup reuses the existing settings tab and retains its unsaved draft', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    await p.settingsPage.evaluate(async (key) => {
      const current = (await chrome.storage.local.get(key))[key];
      await chrome.storage.local.set({ [key]: { ...current, providerConsent: '' } });
    }, STORAGE_KEY);
    const settings = await p.context.newPage();
    await settings.goto(`chrome-extension://${p.extensionId}/index.html`);
    await settings.locator('#target-language').selectOption('ko');
    await settings.evaluate(() => {
      document.documentElement.dataset.draftVisit = 'preserved';
    });
    await p.settingsPage.reload();
    const count = p.context.pages().length;
    await p.settingsPage.getByRole('button', { name: 'Review caption data consent' }).click();
    await expect(settings).toHaveURL(/#service$/);
    await expect(settings.getByRole('heading', { level: 1 })).toHaveText('Translation service');
    expect(await settings.evaluate(() => document.documentElement.dataset.draftVisit)).toBe(
      'preserved',
    );
    expect(p.context.pages()).toHaveLength(count);
    await settings.getByRole('button', { name: 'General', exact: true }).click();
    await expect(settings.locator('#target-language')).toHaveValue('ko');
    await expect(settings.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
});

test('settings: navigation and display-mode labels stay on one line at 320px', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    await p.settingsPage.setViewportSize({ width: 320, height: 800 });
    await p.settingsPage.addInitScript(() => {
      Object.defineProperty(navigator, 'language', {
        get: () => new URL(location.href).searchParams.get('ui') ?? 'en',
      });
    });
    for (const locale of ['en', 'zh-CN']) {
      await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html?ui=${locale}`);
      await p.settingsPage
        .getByRole('radio', { name: locale === 'en' ? 'Translation only' : '仅译文', exact: true })
        .check();
      const contentsFit = await p.settingsPage
        .locator('.caption-mode-option')
        .evaluateAll((options) =>
          options.every((option) => {
            const outer = option.getBoundingClientRect();
            return [...option.querySelectorAll('span, svg')].every((child) => {
              const box = child.getBoundingClientRect();
              return (
                box.left >= outer.left &&
                box.right <= outer.right &&
                box.top >= outer.top &&
                box.bottom <= outer.bottom
              );
            });
          }),
        );
      expect(contentsFit).toBe(true);
      const singleLine = await p.settingsPage
        .locator('.nav-item span, .caption-mode-label > span')
        .evaluateAll((labels) =>
          labels.every((label) => {
            const range = document.createRange();
            range.selectNodeContents(label);
            const boxes = [...range.getClientRects()];
            return boxes.length > 0 && boxes.every((box) => Math.abs(box.top - boxes[0].top) < 1);
          }),
        );
      expect(singleLine).toBe(true);
      await p.settingsPage.screenshot({
        path: `.artifacts/ui-redesign/current/settings-320-${locale}.png`,
      });
      await p.settingsPage.locator('.discard-button').click();
    }
  });
});

test('extension pages: settings and popup inherit the brand font in installed Chromium', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    for (const file of ['index.html', 'popup.html']) {
      await p.settingsPage.goto(`chrome-extension://${p.extensionId}/${file}`);
      await p.settingsPage.getByRole('switch', { name: 'Enable subtitles' }).waitFor();
      const fonts = await p.settingsPage.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const body = getComputedStyle(document.body);
        return { root: [root.fontFamily, root.fontSize], body: [body.fontFamily, body.fontSize] };
      });
      expect(fonts.body).toEqual(fonts.root);
    }
  });
});

test('settings: linked sections and browser history preserve a draft across all navigation items', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html#service`);
    await expect(p.settingsPage.getByRole('heading', { level: 1 })).toHaveText(
      'Translation service',
    );
    await p.settingsPage.getByRole('radio', { name: 'Microsoft Translate' }).check();
    await p.settingsPage.getByRole('button', { name: 'General', exact: true }).click();
    await p.settingsPage.getByRole('switch', { name: 'Enable subtitles' }).click();
    await p.settingsPage.goBack();
    await expect(p.settingsPage.getByRole('heading', { level: 1 })).toHaveText(
      'Translation service',
    );
    await expect(p.settingsPage.getByRole('radio', { name: 'Microsoft Translate' })).toBeChecked();
    await p.settingsPage.goForward();
    await expect(p.settingsPage.getByRole('switch', { name: 'Enable subtitles' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    for (const width of [320, 600, 760, 800, 1024, 1360]) {
      await p.settingsPage.setViewportSize({ width, height: 800 });
      const overflowing = await p.settingsPage.locator('.nav-item').evaluateAll((items) =>
        items
          .filter((item) => {
            const style = getComputedStyle(item);
            const range = document.createRange();
            range.selectNodeContents(item.querySelector('span')!);
            return (
              range.getBoundingClientRect().right >
              item.getBoundingClientRect().right - parseFloat(style.paddingRight) + 0.5
            );
          })
          .map((item) => item.textContent),
      );
      expect(overflowing, `navigation labels at ${width}px`).toEqual([]);
      for (const name of ['General', 'Translation service', 'Subtitle style', 'About']) {
        await p.settingsPage.getByRole('button', { name, exact: true }).click();
        await expect(p.settingsPage.getByRole('button', { name: 'Save changes' })).toBeInViewport();
        expect(
          await p.settingsPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBe(true);
        if (name === 'General')
          expect(
            await p.settingsPage.locator('.service-shortcut-value').evaluate((value) => {
              const outer = value.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(value);
              return [...range.getClientRects()].every(
                (box) => box.left >= outer.left - 0.5 && box.right <= outer.right + 0.5,
              );
            }),
            `service shortcut value at ${width}px`,
          ).toBe(true);
      }
    }
    await p.settingsPage.getByRole('button', { name: 'Discard changes' }).click();
    await p.settingsPage.getByRole('button', { name: 'General', exact: true }).click();
    await expect(p.settingsPage.getByRole('switch', { name: 'Enable subtitles' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

for (const viewport of [
  { width: 360, height: 560 },
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 1360, height: 420 },
  { width: 1360, height: 360 },
]) {
  test(`settings: cross-section URL recovery stays visible at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    await withPlayer('x', info, async (p) => {
      await p.settingsPage.setViewportSize(viewport);
      await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html#service`);
      const url = p.settingsPage.locator('#base-url');
      const originalUrl = await url.inputValue();
      await url.fill('invalid-url');
      await p.settingsPage.getByRole('button', { name: 'Subtitle style', exact: true }).click();
      await p.settingsPage.locator('#original-size').fill('32');
      await p.settingsPage.getByRole('button', { name: 'Save changes' }).click();
      await expect(p.settingsPage.getByRole('heading', { level: 1 })).toHaveText(
        'Translation service',
      );
      await expect(url).toBeFocused();
      await expect(url).toHaveValue('invalid-url');
      await expect(url).toHaveAttribute('aria-invalid', 'true');
      const error = p.settingsPage.locator('#base-url-error');
      await expect(error).toContainText('Enter a complete Base URL');
      const staysVisible = await p.settingsPage.evaluate(async () => {
        const start = performance.now();
        while (performance.now() - start < 500) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const heading = document.querySelector('.page-heading')!.getBoundingClientRect();
          const save = document.querySelector('.save-button')!.getBoundingClientRect();
          const title = document.querySelector('h1')!.getBoundingClientRect();
          if (
            heading.top < 0 ||
            title.top < 0 ||
            title.bottom > innerHeight ||
            save.top < 0 ||
            save.bottom > innerHeight
          )
            return false;
          if (
            innerWidth > 520 &&
            (window.scrollY !== 0 || document.documentElement.scrollHeight > innerHeight)
          )
            return false;
          for (const selector of ['#base-url', '#base-url-error']) {
            const box = document.querySelector(selector)!.getBoundingClientRect();
            if (box.top < Math.max(0, heading.bottom) || box.bottom > innerHeight) return false;
          }
        }
        return document.activeElement === document.querySelector('#base-url');
      });
      expect(staysVisible).toBe(true);
      await expect(p.settingsPage.locator('.alert-layer')).toHaveCount(0);
      if (viewport.width <= 520) {
        await expect(p.settingsPage.locator('.brand')).not.toBeInViewport();
      }
      await expect(p.settingsPage.getByRole('button', { name: 'Save changes' })).toBeInViewport({
        ratio: 1,
      });
      await p.settingsPage.screenshot({
        path: `.artifacts/ui-redesign/current/service-error-${viewport.width}x${viewport.height}-en.png`,
      });
      await url.fill(originalUrl);
      await p.settingsPage.getByRole('button', { name: 'Save changes' }).click();
      await expect(p.settingsPage.getByRole('button', { name: 'Settings saved' })).toBeDisabled();
      const notice = p.settingsPage.locator('.settings-alert');
      await expect(notice).toBeVisible();
      expect(
        await p.settingsPage.evaluate(() => {
          const notice = document.querySelector('.settings-alert')!.getBoundingClientRect();
          const heading = document.querySelector('.page-heading')!.getBoundingClientRect();
          return (
            notice.top >= heading.bottom ||
            notice.right <= heading.left ||
            notice.left >= heading.right
          );
        }),
      ).toBe(true);
      await p.settingsPage.getByRole('button', { name: 'Dismiss notification' }).click();
      await p.settingsPage.getByRole('button', { name: 'Subtitle style', exact: true }).click();
      await expect(p.settingsPage.locator('#original-size')).toHaveValue('32');
      await expect(p.settingsPage.getByRole('button', { name: 'Settings saved' })).toBeInViewport({
        ratio: 1,
      });
      if (viewport.width > 520) {
        expect(await p.settingsPage.evaluate(() => window.scrollY)).toBe(0);
        await p.settingsPage.locator('.app-header').hover();
        await p.settingsPage.mouse.wheel(0, 500);
        await expect
          .poll(() => p.settingsPage.locator('.app-header').evaluate((header) => header.scrollTop))
          .toBeGreaterThan(0);
        expect(await p.settingsPage.evaluate(() => window.scrollY)).toBe(0);
        await expect(p.settingsPage.getByRole('heading', { level: 1 })).toBeInViewport({
          ratio: 1,
        });
        await expect(p.settingsPage.getByRole('button', { name: 'Settings saved' })).toBeInViewport(
          { ratio: 1 },
        );
      }
    });
  });
}

test('popup: language names and expanded details fit after saving in both languages', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    const consent = await p.settingsPage.evaluate(async (key) => {
      return (await chrome.storage.local.get(key))[key].providerConsent as string;
    }, STORAGE_KEY);
    await p.settingsPage.addInitScript(() => {
      Object.defineProperty(navigator, 'language', {
        get: () => new URL(location.href).searchParams.get('ui') ?? 'en',
      });
    });
    for (const locale of ['en', 'zh-CN']) {
      for (const setup of [false, true]) {
        await p.settingsPage.evaluate(
          async ({ key, providerConsent }) => {
            const stored = (await chrome.storage.local.get(key))[key];
            await chrome.storage.local.set({ [key]: { ...stored, providerConsent } });
          },
          { key: STORAGE_KEY, providerConsent: setup ? '' : consent },
        );
        await p.settingsPage.goto(`chrome-extension://${p.extensionId}/popup.html?ui=${locale}`);
        const language = p.settingsPage.locator('#popup-target-language');
        await expect(language).toBeEnabled();
        await language.selectOption((await language.inputValue()) === 'ja' ? 'ko' : 'ja');
        await expect(p.settingsPage.locator('.popup-save-state')).toHaveText(
          locale === 'en' ? 'Saved' : '已保存',
        );
        const clipped = await language.evaluate((select: HTMLSelectElement) => {
          const style = getComputedStyle(select);
          const context = document.createElement('canvas').getContext('2d')!;
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const room =
            select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return [...select.options]
            .filter((option) => context.measureText(option.text).width * 1.1 > room)
            .map((option) => option.text);
        });
        expect(clipped).toEqual([]);
        await p.settingsPage.locator('summary').click();
        const popup = p.settingsPage.locator('.popup');
        expect(
          await popup.evaluate((element) => element.getBoundingClientRect().height),
        ).toBeLessThanOrEqual(600);
        await popup.screenshot({
          path: `.artifacts/ui-redesign/current/popup-installed-${locale}-${setup ? 'setup' : 'consent'}.png`,
        });
      }
    }
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

test('settings: wordmark stays on one line in split windows and draft announcements stay mounted', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    await p.settingsPage.addInitScript(() => {
      Object.defineProperty(navigator, 'language', {
        get: () => new URL(location.href).searchParams.get('ui') ?? 'en',
      });
    });
    for (const locale of ['en', 'zh-CN']) {
      await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html?ui=${locale}`);
      for (const width of [901, 960, 1024, 1100, 1180, 1280]) {
        await p.settingsPage.setViewportSize({ width, height: 800 });
        const oneLine = await p.settingsPage.locator('.brand-wordmark').evaluate((wordmark) => {
          const range = document.createRange();
          range.selectNodeContents(wordmark);
          const boxes = [...range.getClientRects()];
          return boxes.length > 0 && boxes.every((box) => Math.abs(box.top - boxes[0].top) < 1);
        });
        expect(oneLine, `${locale} wordmark at ${width}px`).toBe(true);
      }
      await p.settingsPage.setViewportSize({ width: 1024, height: 800 });
      const status = p.settingsPage.locator('.save-state');
      await expect(status).toBeEmpty();
      expect(await status.evaluate((element) => getComputedStyle(element).display)).not.toBe(
        'none',
      );
      await p.settingsPage
        .getByRole('switch', { name: locale === 'en' ? 'Enable subtitles' : '启用字幕' })
        .click();
      await expect(status).toHaveText(locale === 'en' ? 'Unsaved changes' : '有未保存的更改');
      await p.settingsPage.screenshot({
        path: `.artifacts/ui-redesign/current/settings-1024-${locale}.png`,
        animations: 'disabled',
      });
      await p.settingsPage
        .getByRole('button', { name: locale === 'en' ? 'Discard changes' : '撤销更改' })
        .click();
    }
  });
});

test('settings: selected cards keep their accent border while hovered', async ({}, info) => {
  await withPlayer('x', info, async (p) => {
    for (const [hash, selector] of [
      ['general', '.caption-mode-option:has(input:checked)'],
      ['service', '.provider-option:has(input:checked)'],
    ]) {
      await p.settingsPage.goto(`chrome-extension://${p.extensionId}/index.html#${hash}`);
      const card = p.settingsPage.locator(selector);
      await p.settingsPage.mouse.move(0, 0);
      const border = () => card.evaluate((element) => getComputedStyle(element).borderColor);
      const resting = await border();
      await card.hover();
      expect(await border(), `${hash} selected card on hover`).toBe(resting);
    }
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
