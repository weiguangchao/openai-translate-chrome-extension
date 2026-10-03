import { fetchModels, translate } from '../shared/api';
import { prefetchWindowLimit } from '../shared/limits';
import { normalizeSettings, publicSettings, STORAGE_KEY, type Settings } from '../shared/settings';
import { TranslationQueue } from './queue';

const queue = new TranslationQueue();
let settings: Settings;
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  settings = normalizeSettings((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
})();

function supportedSender(sender: chrome.runtime.MessageSender): boolean {
  try {
    const url = new URL(sender.url ?? '');
    return (
      url.protocol === 'https:' &&
      /(^|\.)(youtube\.com|max\.com|hbomax\.com|hbo\.com)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  const data = message as {
    type: string;
    settings?: unknown;
    text?: unknown;
    texts?: unknown;
    segments?: unknown;
    needsSplit?: unknown;
    pause?: unknown;
    cacheOnly?: unknown;
  };
  const trusted =
    sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!trusted && !supportedSender(sender)) return;
  void (async () => {
    await ready;
    if (data.type === 'settings') return publicSettings(settings);
    if (trusted && ['models', 'test'].includes(data.type)) {
      const draft = normalizeSettings(data.settings);
      return data.type === 'models'
        ? fetchModels(draft)
        : translate(draft, 'The world is full of wonderful things.');
    }
    if (['translate', 'prefetch'].includes(data.type) && supportedSender(sender)) {
      const consumer = `${sender.tab?.id}:${sender.frameId}`;
      if (data.type === 'prefetch' && Array.isArray(data.texts) && !data.texts.length) {
        if (data.pause === true) queue.pause(consumer);
        else if (data.pause === false) queue.resume(consumer);
        else queue.prefetch(consumer, settings, []);
        return;
      }
      const youtube = new URL(sender.url!).hostname.endsWith('youtube.com');
      if (!settings.enabled || !(youtube ? settings.youtube : settings.hbo))
        throw new Error('双语字幕已关闭。');
      if (data.type === 'prefetch') {
        if (
          !Array.isArray(data.texts) ||
          data.texts.length > prefetchWindowLimit ||
          data.texts.some(
            (text) => typeof text !== 'string' || !text.trim() || text.length > 5000,
          ) ||
          (data.segments !== undefined &&
            (!Array.isArray(data.segments) ||
              data.segments.length !== data.texts.length ||
              data.segments.some((segment) => !Number.isSafeInteger(segment) || segment < 0))) ||
          (data.needsSplit !== undefined &&
            (!Array.isArray(data.needsSplit) ||
              data.needsSplit.length !== data.texts.length ||
              data.needsSplit.some((flag) => typeof flag !== 'boolean')))
        )
          throw new Error('预加载字幕内容无效。');
        const texts = data.texts as string[];
        const segments = (data.segments ?? []) as number[];
        const needsSplit = (data.needsSplit ?? []) as boolean[];
        const keys = texts.map((text, index) => JSON.stringify([text, needsSplit[index] === true]));
        const unique = [...new Set(keys)].map((key) => keys.indexOf(key));
        const results = await queue.prefetch(
          consumer,
          settings,
          unique.map((index) => texts[index]),
          unique.map((index) => segments[index] ?? 0),
          unique.map((index) => needsSplit[index] === true),
        );
        return keys.map((key) => results[unique.indexOf(keys.indexOf(key))]);
      }
      if (
        typeof data.text !== 'string' ||
        !data.text.trim() ||
        data.text.length > 5000 ||
        (data.needsSplit !== undefined && typeof data.needsSplit !== 'boolean')
      )
        throw new Error('字幕内容无效。');
      return data.cacheOnly === true
        ? queue.lookup(settings, data.text, data.needsSplit === true)
        : queue.request(consumer, settings, data.text, data.needsSplit === true);
    }
    throw new Error('不支持的请求。');
  })().then(
    (result) => respond({ ok: true, data: result }),
    (error) => respond({ ok: false, error: error instanceof Error ? error.message : '请求失败。' }),
  );
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  void (async () => {
    await ready;
    settings = normalizeSettings(changes[STORAGE_KEY].newValue);
    queue.reset();
    const tabs = await chrome.tabs.query({
      url: [
        'https://*.youtube.com/*',
        'https://*.max.com/*',
        'https://*.hbomax.com/*',
        'https://*.hbo.com/*',
      ],
    });
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id !== undefined)
        .map((tab) =>
          chrome.tabs.sendMessage(tab.id!, {
            type: 'settings-updated',
            settings: publicSettings(settings),
          }),
        ),
    );
  })();
});
