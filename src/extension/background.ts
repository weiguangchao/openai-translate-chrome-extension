import { fetchModels, translate } from '../shared/api';
import { failureOf, UnsupportedLanguageError } from '../shared/provider-error';
import {
  readHoldRequest,
  readPrefetchRequest,
  readTranslateRequest,
  requestType,
  type SettingsUpdated,
} from '../shared/messages';
import { platformForUrl, platformMatches, type PlatformId } from '../shared/platforms';
import {
  classifySettingsChange,
  hasProviderConsent,
  normalizeSettings,
  publicSettings,
  STORAGE_KEY,
  type Settings,
} from '../shared/settings';
import { loadSettings } from '../shared/storage';
import { printTrace, readTraceRequest } from '../shared/trace';
import { TranslationQueue, translationCacheLimit } from './queue';
import { restoreTranslations } from './translation-store';

const queue = new TranslationQueue(translationCacheLimit, printTrace);
let settings: Settings;
let translationRevision = crypto.randomUUID();
let updateSequence = 0;
const consumers = new Map<string, { platform: PlatformId; document?: string }>();
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  settings = await loadSettings();
  await restoreTranslations(queue);
})();

function requireEnabled(platform: PlatformId): void {
  if (!settings.enabled || !settings[platform]) throw new Error('双语字幕已关闭。');
  if (!hasProviderConsent(settings)) throw new Error('请先在设置中同意将字幕发送给 Provider。');
}

async function contentRequest(
  type: string,
  message: object,
  platform: PlatformId,
  consumer: string,
  document?: string,
): Promise<unknown> {
  const previous = consumers.get(consumer);
  if (previous && previous.document !== document) queue.release([consumer]);
  consumers.set(consumer, { platform, document });
  if (type === 'prefetch-pause' || type === 'prefetch-resume') {
    if (type === 'prefetch-pause') queue.pause(consumer);
    else queue.resume(consumer);
    return;
  }
  if (type === 'prefetch-hold') {
    queue.hold(consumer, readHoldRequest(message).time);
    return;
  }
  if (type === 'prefetch') {
    const snapshot = readPrefetchRequest(message);
    if (!snapshot.cues.length) {
      consumers.delete(consumer);
      queue.release([consumer]);
      return;
    }
    requireEnabled(platform);
    if (!snapshot.captionLanguage) throw new UnsupportedLanguageError();
    return queue.prefetch(
      consumer,
      { ...settings, captionLanguage: snapshot.captionLanguage },
      snapshot.cues,
      snapshot.time,
      snapshot.rate,
    );
  }
  if (type === 'translate') {
    requireEnabled(platform);
    const { text, cacheOnly, captionLanguage } = readTranslateRequest(message);
    const effective = { ...settings, captionLanguage };
    return cacheOnly ? queue.lookup(effective, text) : queue.request(consumer, effective, text);
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
    if (type === 'settings') return publicSettings(settings, translationRevision);
    if (trusted && (type === 'models' || type === 'test')) {
      const draft = normalizeSettings((message as { settings?: unknown }).settings);
      return type === 'models'
        ? fetchModels(draft)
        : translate(draft, 'The world is full of wonderful things.');
    }
    if (!platform) throw new Error('不支持的请求。');
    const consumer = `${sender.tab?.id}:${sender.frameId}`;
    if (type === 'trace')
      return printTrace({ e: 'view', tab: consumer, ...readTraceRequest(message as object) });
    return contentRequest(type, message as object, platform, consumer, sender.documentId);
  })().then(
    (result) => respond({ ok: true, data: result }),
    (error) => respond({ ok: false, failure: failureOf(error, '请求失败。') }),
  );
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  const sequence = ++updateSequence;
  void (async () => {
    await ready;
    const next = await loadSettings();
    if (sequence !== updateSequence) return;
    const change = classifySettingsChange(settings, next);
    settings = next;
    if (change.translation) translationRevision = crypto.randomUUID();
    if (change.translation || !settings.enabled || !hasProviderConsent(settings)) {
      queue.reset();
      consumers.clear();
    } else if (change.availability) {
      const disabled = [...consumers]
        .filter(([, { platform }]) => !settings[platform])
        .map(([consumer]) => consumer);
      for (const consumer of disabled) consumers.delete(consumer);
      queue.release(disabled);
    }
    const update: SettingsUpdated = {
      type: 'settings-updated',
      settings: publicSettings(settings, translationRevision),
    };
    const tabs = await chrome.tabs.query({ url: [...platformMatches] });
    if (sequence !== updateSequence) return;
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id !== undefined)
        .map((tab) => chrome.tabs.sendMessage(tab.id!, update)),
    );
  })();
});
