import type { PlatformId } from '../../shared/platforms';
import { bridgeMessages, readTimelineState, type TimelineState } from './protocol';

export class BridgeTimeline {
  private messages: ReturnType<typeof bridgeMessages>;
  private requestId = 0;
  private pendingId = 0;
  private requestedAt = -Infinity;
  private context = '';
  private state: TimelineState | null = null;
  private revision = -1;

  constructor(
    channel: PlatformId,
    private changed: () => void,
  ) {
    this.messages = bridgeMessages(channel);
    window.addEventListener('message', this.receive);
  }

  read(videoId: string, sourceLanguage: string): TimelineState | null {
    const context = JSON.stringify([videoId, sourceLanguage]);
    if (context !== this.context) {
      this.reset();
      this.context = context;
    }
    if (Date.now() - this.requestedAt >= 1000) {
      this.requestedAt = Date.now();
      this.pendingId = ++this.requestId;
      window.postMessage(
        {
          type: this.messages.request,
          requestId: this.pendingId,
          videoId,
          sourceLanguage,
          revision: this.revision,
        },
        location.origin,
      );
    }
    return this.state;
  }

  private receive = (event: MessageEvent) => {
    const data = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      data?.type !== this.messages.response ||
      !this.pendingId ||
      data.requestId !== this.pendingId ||
      data.unchanged === true ||
      !Number.isSafeInteger(data.revision)
    )
      return;
    const state = readTimelineState(data.state);
    if (!state) return;
    this.state = state;
    this.revision = data.revision;
    this.changed();
  };

  reset(): void {
    if (this.pendingId)
      window.postMessage({ type: this.messages.stop, requestId: this.pendingId }, location.origin);
    this.context = '';
    this.state = null;
    this.pendingId = 0;
    this.requestedAt = -Infinity;
    this.revision = -1;
  }

  destroy(): void {
    this.reset();
    window.removeEventListener('message', this.receive);
  }
}
