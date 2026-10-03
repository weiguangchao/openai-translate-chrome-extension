import { fetchModels, translate } from '../shared/api';
import {
  emptyPrefetch,
  readPrefetchRequest,
  readTranslateRequest,
  requestType,
  type SettingsUpdated,
} from '../shared/messages';
import { platformForUrl, platformMatches, type PlatformId } from '../shared/platforms';
import { normalizeSettings, publicSettings, STORAGE_KEY, type Settings } from '../shared/settings';
import { TranslationQueue } from './queue';

const queue = new TranslationQueue();
let settings: Settings;
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  settings = normalizeSettings((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
})();

function requireEnabled(platform: PlatformId): void {
  if (!settings.enabled || !settings[platform]) throw new Error('双语字幕已关闭。');
}

async function contentRequest(
  type: string,
  message: object,
  platform: PlatformId,
  consumer: string,
): Promise<unknown> {
  if (type === 'prefetch-pause' || type === 'prefetch-resume') {
    if (type === 'prefetch-pause') queue.pause(consumer);
    else queue.resume(consumer);
    return;
  }
  if (type === 'prefetch') {
    if (emptyPrefetch(message)) {
      void queue.prefetch(consumer, settings, []);
      return;
    }
    requireEnabled(platform);
    const { texts, segments, needsSplit } = readPrefetchRequest(message);
    const keys = texts.map((text, index) => JSON.stringify([text, needsSplit[index]]));
    const unique = [...new Set(keys)].map((key) => keys.indexOf(key));
    const results = await queue.prefetch(
      consumer,
      settings,
      unique.map((index) => texts[index]),
      unique.map((index) => segments[index]),
      unique.map((index) => needsSplit[index]),
    );
    return keys.map((key) => results[unique.indexOf(keys.indexOf(key))]);
  }
  if (type === 'translate') {
    requireEnabled(platform);
    const { text, needsSplit, cacheOnly } = readTranslateRequest(message);
    return cacheOnly
      ? queue.lookup(settings, text, needsSplit)
      : queue.request(consumer, settings, text, needsSplit);
  }
  throw new Error('不支持的请求。');
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const type = requestType(message);
  if (!type) return;
  const trusted =
    sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  const platform = platformForUrl(sender.url);
  if (!trusted && !platform) return;
  void (async () => {
    await ready;
    if (type === 'settings') return publicSettings(settings);
    if (trusted && (type === 'models' || type === 'test')) {
      const draft = normalizeSettings((message as { settings?: unknown }).settings);
      return type === 'models'
        ? fetchModels(draft)
        : translate(draft, 'The world is full of wonderful things.');
    }
    if (platform)
      return contentRequest(
        type,
        message as object,
        platform,
        `${sender.tab?.id}:${sender.frameId}`,
      );
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
    const tabs = await chrome.tabs.query({ url: [...platformMatches] });
    const update: SettingsUpdated = {
      type: 'settings-updated',
      settings: publicSettings(settings),
    };
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id !== undefined)
        .map((tab) => chrome.tabs.sendMessage(tab.id!, update)),
    );
  })();
});
