import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sessionStorage, extensionPermissions } from './fixtures/extension-storage';
import { portPair } from './fixtures/ports';
import { consentedSettings } from './fixtures/settings';
import {
  MICROSOFT_ORIGIN,
  translationIdentity,
  type CaptionTranslationSettings,
} from '../src/shared/settings';
import { RECOVERY_PORT } from '../src/shared/recovery';
import { TranslationStore } from '../src/extension/translation-store';
import { RecoveryPorts } from '../src/extension/recovery';
import { MicrosoftAccess } from '../src/extension/microsoft-access';
import { packedCues } from './fixtures/provider';
import { providerSendWindowMs, translationSendsPerSecond } from '../src/shared/tuning';

let queues: typeof import('../src/extension/queue');
const settings = {
  ...consentedSettings,
  apiKey: 'key',
  model: 'model',
  providerConsent: `https://api.openai.com,${MICROSOFT_ORIGIN}`,
};
const effective: CaptionTranslationSettings = {
  ...settings,
  captionLanguage: 'en',
  pageTitle: 'Video',
};
const microsoft = { ...effective, provider: 'microsoft' as const };
const flush = () => vi.advanceTimersByTimeAsync(0);
let pending: { texts: string[]; resolve: (value: Response) => void; signal: AbortSignal }[];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  pending = [];
  vi.stubGlobal('chrome', { runtime: { id: 'extension' }, storage: { session: sessionStorage() } });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push({ texts: JSON.parse(init.body as string), resolve, signal: init.signal! });
        }),
    ),
  );
  queues = await import('../src/extension/queue');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function answer(index: number) {
  pending[index].resolve(
    Response.json(
      pending[index].texts.map((text) => ({
        translations: [{ text: `微软 ${text}`, to: 'zh-Hans' }],
      })),
    ),
  );
}

function connection(ports: RecoveryPorts, text = 'Current') {
  const pair = portPair(
    RECOVERY_PORT +
      JSON.stringify({
        type: 'translate',
        text,
        captionLanguage: 'en',
        pageTitle: 'Video',
        revision: 'version',
        paused: false,
      }),
    {
      id: 'extension',
      tab: { id: 1 } as chrome.tabs.Tab,
      frameId: 0,
      documentId: 'document',
      url: 'https://www.youtube.com/watch?v=test',
    },
  );
  const received: unknown[] = [];
  pair.client.onMessage.addListener((message) => received.push(message));
  ports.connect(pair.server);
  return { ...pair, received };
}

it('waits for a late sync reply, then sends the current caption without another event', async () => {
  const queue = new queues.HybridTranslationQueue();
  const ports = new RecoveryPorts(
    queue,
    Promise.resolve(),
    () => settings,
    () => 'version',
    () => true,
  );
  const { client, received } = connection(ports);
  await flush();
  expect(received).toEqual([{ type: 'sync' }]);
  expect(pending).toHaveLength(0);
  client.postMessage({ type: 'sync-state', paused: false });
  await flush();
  expect(pending.map(({ texts }) => texts)).toEqual([['Current']]);
  expect(received).toContainEqual({ type: 'sent' });
  answer(0);
  await flush();
  expect(received).toContainEqual({ type: 'translation', translation: '微软 Current' });
  expect(pending).toHaveLength(1);
});

it('keeps a cache miss paused through synchronization and resumes exactly once', async () => {
  const queue = new queues.HybridTranslationQueue();
  const ports = new RecoveryPorts(
    queue,
    Promise.resolve(),
    () => settings,
    () => 'version',
    () => true,
  );
  const { client } = connection(ports);
  client.postMessage({ type: 'sync-state', paused: true });
  await flush();
  expect(pending).toHaveLength(0);
  client.postMessage({ type: 'state', paused: false });
  client.postMessage({ type: 'state', paused: false });
  await flush();
  expect(pending).toHaveLength(1);
  client.disconnect();
  await flush();
});

it('closes a disconnected cold-start subscription before any request can be sent', async () => {
  let ready!: () => void;
  const queue = new queues.HybridTranslationQueue();
  const ports = new RecoveryPorts(
    queue,
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
    () => settings,
    () => 'version',
    () => true,
  );
  const { client } = connection(ports);
  client.disconnect();
  await flush();
  ready();
  await flush();
  expect(pending).toHaveLength(0);
});

it('rechecks the primary cache even when a shared job already has a controller', async () => {
  const queue = new queues.TranslationQueue();
  for (let index = 0; index < translationSendsPerSecond; index++)
    void queue.request(`busy-${index}`, microsoft, `Busy ${index}`);
  await flush();
  void queue.prefetch('other', microsoft, packedCues(['Current', 'Neighbor'], 8), 0, 1, {
    fallback: effective,
  });
  await flush();
  queue.pause('other');
  const key = JSON.stringify([...translationIdentity(effective), 'Current']);
  await new TranslationStore().save({
    key,
    translation: 'Cached current',
    provider: 'openai',
    temporary: false,
  });
  const result = queue.recover(
    'page#resume',
    microsoft,
    'Current',
    effective,
    false,
    true,
    () => {},
  );
  await flush();
  await expect(result).resolves.toBe('Cached current');
  await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  expect(pending.flatMap(({ texts }) => texts)).not.toContain('Current');
  queue.reset();
});

it('splits an unsent shared pack without sending or rejecting the paused neighbors', async () => {
  const queue = new queues.TranslationQueue();
  for (let index = 0; index < translationSendsPerSecond; index++)
    void queue.request(`busy-${index}`, microsoft, `Busy ${index}`);
  await flush();
  let settled = false;
  void queue
    .prefetch('other', microsoft, packedCues(['Current', 'Neighbor'], 8), 0, 1, {
      fallback: effective,
    })
    .then(() => {
      settled = true;
    });
  await flush();
  queue.pause('other');
  const current = queue.recover(
    'page#resume',
    microsoft,
    'Current',
    effective,
    false,
    true,
    () => {},
  );
  await flush();
  await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  expect(pending.at(-1)?.texts).toEqual(['Current']);
  expect(pending.flatMap(({ texts }) => texts)).not.toContain('Neighbor');
  answer(pending.length - 1);
  await flush();
  await expect(current).resolves.toBe('微软 Current');
  expect(settled).toBe(false);
  queue.releaseRecovery('page#resume');
  queue.resume('other');
  await flush();
  expect(pending.at(-1)?.texts).toEqual(['Neighbor']);
  answer(pending.length - 1);
  await flush();
  expect(settled).toBe(true);
  queue.reset();
});

it('sends surviving shared jobs after another member of their unsent batch is pruned', async () => {
  const queue = new queues.TranslationQueue();
  for (let index = 0; index < translationSendsPerSecond; index++)
    void queue.request(`busy-${index}`, microsoft, `Busy ${index}`);
  await flush();
  void queue.prefetch('other', microsoft, packedCues(['Pruned', 'Survivor'], 8), 0, 1, {
    fallback: effective,
  });
  await flush();
  const ordinary = queue.request('page', microsoft, 'Survivor', { fallback: effective });
  queue.release(['other']);
  const recovered = queue.recover(
    'page#resume',
    microsoft,
    'Survivor',
    effective,
    false,
    true,
    () => {},
  );
  await flush();
  await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  expect(pending).toHaveLength(translationSendsPerSecond + 1);
  expect(pending.at(-1)?.texts).toEqual(['Pruned', 'Survivor']);
  answer(pending.length - 1);
  await expect(ordinary).resolves.toBe('微软 Survivor');
  await expect(recovered).resolves.toBe('微软 Survivor');
  queue.reset();
});

it('does not revive orphaned preview bytes when storage cleanup fails', async () => {
  const key = JSON.stringify([...translationIdentity(microsoft), 'Current']);
  const stored = new Map<string, unknown>([
    ['subline.translation.preview.keys', [key]],
    ['subline.translation.preview:' + key, 'Expired'],
  ]);
  const session = sessionStorage(stored);
  session.remove.mockRejectedValue(new Error('Storage unavailable'));
  vi.stubGlobal('chrome', { storage: { session } });
  const queue = new queues.TranslationQueue();
  await expect(
    queue.recover('page#resume', microsoft, 'Current', effective, false, true, () => {}),
  ).resolves.toBeNull();
  expect(pending).toHaveLength(0);
});

it('does not enqueue fallback work after permission is lost during prefetch lookup', async () => {
  let allowed = true;
  const queue = new queues.TranslationQueue(
    new TranslationStore(),
    () => {},
    () => allowed,
  );
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  const original = session.get.getMockImplementation()!;
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  session.get.mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const work = queue.prefetch('page', microsoft, packedCues(['Current']), 0, 1, {
    fallback: effective,
  });
  await flush();
  allowed = false;
  queue.cancelFallback();
  unblock();
  await flush();
  await expect(work).resolves.toEqual([null]);
  expect(pending).toHaveLength(0);
});

it('uses the existing deadline to finish a sent subscription while storage is stalled', async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  const queue = new queues.HybridTranslationQueue();
  const ports = new RecoveryPorts(
    queue,
    Promise.resolve(),
    () => settings,
    () => 'version',
    () => true,
  );
  const { client, received } = connection(ports);
  let disconnected = false;
  client.onDisconnect.addListener(() => {
    disconnected = true;
  });
  client.postMessage({ type: 'sync-state', paused: false });
  await flush();
  expect(received).toContainEqual({ type: 'sent' });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(chrome.storage.session, 'set').mockImplementation(async () => gate);
  answer(0);
  await flush();
  expect(received.some((event) => (event as { type: string }).type === 'translation')).toBe(false);
  timeout.abort();
  await flush();
  expect(disconnected).toBe(true);
  release();
  await flush();
  expect(pending).toHaveLength(1);
});

it('revokes host access synchronously and ignores an older permission result', async () => {
  const permissions = extensionPermissions();
  vi.stubGlobal('chrome', { permissions });
  const revoked = vi.fn();
  const access = new MicrosoftAccess(revoked);
  await access.refresh();
  expect(access.allowed).toBe(true);
  let oldResult!: (value: boolean) => void;
  permissions.contains.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        oldResult = resolve;
      }),
  );
  const oldCheck = access.refresh();
  permissions.contains.mockResolvedValue(false);
  const removed = permissions.onRemoved.addListener.mock.calls[0][0] as (
    value: chrome.permissions.Permissions,
  ) => void;
  removed({ origins: [`${MICROSOFT_ORIGIN}/*`] });
  expect(access.allowed).toBe(false);
  expect(revoked).toHaveBeenCalledOnce();
  oldResult(true);
  await oldCheck;
  await flush();
  expect(access.allowed).toBe(false);
});

it('does not cancel Microsoft work when an unrelated host permission is removed', async () => {
  const permissions = extensionPermissions();
  vi.stubGlobal('chrome', { permissions });
  const revoked = vi.fn();
  const access = new MicrosoftAccess(revoked);
  await access.refresh();
  const removed = permissions.onRemoved.addListener.mock.calls[0][0] as (
    value: chrome.permissions.Permissions,
  ) => void;
  removed({ origins: ['https://example.org/*'] });
  expect(access.allowed).toBe(true);
  expect(revoked).not.toHaveBeenCalled();
});

it('settles permission-cancelled fallback jobs without retrying or recording a provider failure', async () => {
  let allowed = true;
  const queue = new queues.TranslationQueue(
    new TranslationStore(),
    () => {},
    () => allowed,
  );
  for (let index = 0; index < translationSendsPerSecond; index++)
    void queue.request(`busy-${index}`, microsoft, `Busy ${index}`);
  await flush();
  const work = queue.request('page', microsoft, 'Current', { fallback: effective });
  const outcome = work.catch((error: Error) => error.message);
  await flush();
  allowed = false;
  queue.cancelFallback();
  await expect(outcome).resolves.toBe('Subtitles have changed.');
  await expect(queue.request('page', microsoft, 'Later', { fallback: effective })).rejects.toThrow(
    'Subtitles have changed.',
  );
  allowed = true;
  await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  expect(pending.flatMap(({ texts }) => texts)).not.toContain('Current');
  const retry = queue.request('page', microsoft, 'Current', { fallback: effective });
  await flush();
  expect(pending.at(-1)?.texts).toEqual(['Current']);
  answer(pending.length - 1);
  await expect(retry).resolves.toBe('微软 Current');
  queue.reset();
});
