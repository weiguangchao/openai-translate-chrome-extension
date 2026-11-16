import {
  RECOVERY_PORT,
  recoveryRequest,
  type RecoveryRequest,
  type RecoveryEvent,
} from '../shared/recovery';
import { platformForUrl, type PlatformId } from '../shared/platforms';
import type { Settings } from '../shared/settings';
import type { HybridTranslationQueue } from './queue';

interface Subscription {
  port: chrome.runtime.Port;
  parent: string;
  child: string;
  request: RecoveryRequest;
  platform: PlatformId;
  document?: string;
  paused: boolean;
  synced: boolean;
  closed: boolean;
  unbind?: () => void;
}

export class RecoveryPorts {
  private records = new Map<string, Subscription>();

  constructor(
    private queue: HybridTranslationQueue,
    private ready: Promise<unknown>,
    private settings: () => Settings,
    private revision: () => string,
    private allowed: (platform: PlatformId) => boolean,
  ) {}

  connect = (port: chrome.runtime.Port): void => {
    if (!port.name.startsWith(RECOVERY_PORT)) return;
    const platform = platformForUrl(port.sender?.url);
    if (!platform || port.sender?.id !== chrome.runtime.id || port.sender.tab?.id === undefined) {
      port.disconnect();
      return;
    }
    let request: RecoveryRequest;
    try {
      request = recoveryRequest(port.name);
    } catch {
      port.disconnect();
      return;
    }
    const parent = `${port.sender.tab.id}:${port.sender.frameId}`;
    const record: Subscription = {
      port,
      parent,
      child: `${parent}#resume`,
      request,
      platform,
      document: port.sender.documentId,
      paused: request.paused,
      synced: false,
      closed: false,
    };
    port.onDisconnect.addListener(() => this.close(record));
    port.onMessage.addListener((message: unknown) => {
      if (!this.current(record) || !message || typeof message !== 'object') return;
      const { type, paused } = message as Record<string, unknown>;
      if ((type !== 'state' && type !== 'sync-state') || typeof paused !== 'boolean') return;
      record.paused = paused;
      if (type === 'sync-state') record.synced = true;
      this.queue.recoveryState(record.child, paused, record.synced);
    });
    const previous = this.records.get(parent);
    const transfer =
      previous &&
      previous.document === record.document &&
      JSON.stringify({ ...previous.request, paused: false }) ===
        JSON.stringify({ ...request, paused: false });
    if (previous) this.close(previous, !transfer);
    this.records.set(parent, record);
    this.queue.recoveryState(record.child, request.paused, false);
    if (!this.post(record, { type: 'sync' })) return;
    void this.start(record);
  };

  closeParent(parent: string): void {
    const record = this.records.get(parent);
    if (record) this.close(record);
  }

  closeDocument(parent: string, document?: string): void {
    const record = this.records.get(parent);
    if (record && record.document !== document) this.close(record);
  }

  closeAll(): void {
    for (const record of this.records.values()) this.close(record);
  }

  private current(record: Subscription): boolean {
    return !record.closed && this.records.get(record.parent) === record;
  }

  private valid(record: Subscription): boolean {
    return (
      this.current(record) &&
      record.request.revision === this.revision() &&
      this.settings().provider === 'openai' &&
      this.allowed(record.platform)
    );
  }

  private post(record: Subscription, event: RecoveryEvent): boolean {
    if (!this.current(record)) return false;
    try {
      record.port.postMessage(event);
      return true;
    } catch {
      this.close(record);
      return false;
    }
  }

  private async start(record: Subscription): Promise<void> {
    try {
      await this.ready;
      if (!this.valid(record)) return;
      const settings = {
        ...this.settings(),
        captionLanguage: record.request.captionLanguage,
        pageTitle: record.request.pageTitle,
      };
      const translation = await this.queue.recover(
        record.child,
        settings,
        record.request.text,
        record.paused,
        record.synced,
        (signal) => {
          if (!this.current(record)) return;
          record.unbind?.();
          const expired = () => queueMicrotask(() => this.close(record));
          signal.addEventListener('abort', expired, { once: true });
          record.unbind = () => signal.removeEventListener('abort', expired);
          try {
            record.port.postMessage({ type: 'sent' } satisfies RecoveryEvent);
          } catch {
            queueMicrotask(() => this.close(record));
          }
          if (signal.aborted) expired();
        },
        () => this.valid(record),
      );
      if (translation !== null && this.valid(record))
        this.post(record, { type: 'translation', translation });
    } catch {
      this.post(record, { type: 'ended' });
    } finally {
      this.close(record);
    }
  }

  private close(record: Subscription, release = true): void {
    if (record.closed) return;
    record.closed = true;
    record.unbind?.();
    if (this.records.get(record.parent) === record) {
      this.records.delete(record.parent);
      if (release) this.queue.releaseRecovery(record.child);
    }
    try {
      record.port.disconnect();
    } catch {}
  }
}
