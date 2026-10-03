import type { SubtitleTimeline, TimedCue } from './timeline';
import type { YoutubeCaptionKind } from './youtube-captions';

export class SourceCache {
  state: SubtitleTimeline = { mode: 'checking', source: null };
  revision = 0;
  private key = '';
  private resource = '';
  private controller = new AbortController();
  private pending = false;
  private loaded = false;
  private retryAt = 0;

  constructor(private changed: () => void) {}

  select(video: string, track: string, language: string, kind?: YoutubeCaptionKind | null): void {
    const key = JSON.stringify([video, track, language]);
    if (key === this.key) return;
    this.clear();
    this.key = key;
    this.state = { mode: 'checking', source: null, sourceId: key, sourceKind: kind };
  }

  load(
    resource: string,
    read: (signal: AbortSignal) => Promise<TimedCue[]>,
    fallback: TimedCue[] | null = null,
  ): void {
    if (this.loaded) return;
    if (resource !== this.resource) {
      this.stop();
      this.resource = resource;
    }
    if (this.pending || Date.now() < this.retryAt) return;
    this.pending = true;
    const active = this.controller;
    void read(active.signal)
      .then((source) => {
        if (active.signal.aborted) return;
        this.state = { ...this.state, mode: 'model', source };
        this.loaded = true;
        this.revision++;
        this.changed();
      })
      .catch(() => {
        if (active.signal.aborted) return;
        this.retryAt = Date.now() + 15000;
        this.state = { ...this.state, mode: 'model', source: fallback };
        this.revision++;
        this.changed();
      })
      .finally(() => {
        if (!active.signal.aborted) this.pending = false;
      });
  }

  stop(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.pending = false;
    this.retryAt = 0;
  }

  clear(): void {
    this.stop();
    this.key = '';
    this.resource = '';
    this.loaded = false;
    this.state = { mode: 'checking', source: null };
    this.revision++;
  }
}

export function pageVideoId(): string {
  if (/(^|\.)youtube\.com$/.test(location.hostname))
    return new URL(location.href).searchParams.get('v') ?? location.pathname.split('/')[2] ?? '';
  return `${location.origin}${location.pathname}`;
}

export function mediaIdentity(value: string): string {
  const url = new URL(value);
  for (const name of [...url.searchParams.keys()]) {
    if (
      /^(token|access_token|auth|authorization|jwt|policy|signature|key-pair-id|expires?|exp|hdnea|hdnts|x-amz-.+)$/i.test(
        name,
      )
    )
      url.searchParams.delete(name);
  }
  url.hash = '';
  url.searchParams.sort();
  return url.href;
}
