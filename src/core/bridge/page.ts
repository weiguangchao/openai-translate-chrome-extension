import type { PlatformId } from '../../shared/platforms';
import { bridgeMessages, type TimelineRequest } from './protocol';
import { SourceCache } from './source-cache';

export interface PageTimeline {
  videoId(): string;
  update(request: TimelineRequest, cache: SourceCache): void;
}

export function servePageTimeline(channel: PlatformId, timeline: PageTimeline): void {
  const messages = bridgeMessages(channel);
  let latest: { requestId: number; revision: unknown } | undefined;
  const cache = new SourceCache(publish);

  function publish(): void {
    if (!latest) return;
    window.postMessage(
      {
        type: messages.response,
        requestId: latest.requestId,
        revision: cache.revision,
        ...(latest.revision === cache.revision ? { unchanged: true } : { state: cache.state }),
      },
      location.origin,
    );
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin) return;
    if (data?.type === messages.stop && data.requestId === latest?.requestId) {
      latest = undefined;
      cache.stop();
      return;
    }
    if (
      data?.type !== messages.request ||
      !Number.isSafeInteger(data.requestId) ||
      typeof data.videoId !== 'string' ||
      data.videoId !== timeline.videoId() ||
      typeof data.sourceLanguage !== 'string' ||
      data.sourceLanguage.length > 40
    )
      return;
    timeline.update({ videoId: data.videoId, sourceLanguage: data.sourceLanguage }, cache);
    latest = { requestId: data.requestId, revision: data.revision };
    publish();
  });

  window.addEventListener('pagehide', () => {
    latest = undefined;
    cache.clear();
  });
}
