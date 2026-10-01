import { fetchModels, translate } from '../shared/api';
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
    segment?: unknown;
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
        queue.prefetch(consumer, settings, []);
        return;
      }
      const youtube = new URL(sender.url!).hostname.endsWith('youtube.com');
      if (!settings.enabled || !(youtube ? settings.youtube : settings.hbo))
        throw new Error('双语字幕已关闭。');
      if (data.type === 'prefetch') {
        if (
          !Array.isArray(data.texts) ||
          data.texts.length > 15 ||
          data.texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 5000)
        )
          throw new Error('预加载字幕内容无效。');
        queue.prefetch(
          consumer,
          settings,
          [...new Set(data.texts as string[])],
          data.segment === true,
        );
        return;
      }
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 5000)
        throw new Error('字幕内容无效。');
      return queue.request(consumer, settings, data.text, data.segment === true);
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
