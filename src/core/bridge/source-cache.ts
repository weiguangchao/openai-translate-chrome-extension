import type { TimedCue } from '../cues';
import type { TimelineState } from './protocol';

export class SourceCache {
  private current: TimelineState = { mode: 'checking', source: null };
  private version = 0;

  get state(): Readonly<Omit<TimelineState, 'source'>> & {
    readonly source: readonly Readonly<TimedCue>[] | null;
  } {
    return this.current;
  }

  get revision(): number {
    return this.version;
  }
  private key = '';
  private resource = '';
  private controller = new AbortController();
  private pending = false;
  private loaded = false;
  private retryAt = 0;

  constructor(private changed: () => void) {}

  select(video: string, track: string, language: string): void {
    const key = JSON.stringify([video, track, language]);
    if (key === this.key) return;
    this.clear();
    this.key = key;
    this.current = { mode: 'checking', source: null, sourceId: key };
  }

  update(patch: Partial<Pick<TimelineState, 'mode' | 'source'>>): void {
    this.current = { ...this.current, ...patch };
    this.version++;
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
        this.current = { ...this.current, mode: 'model', source };
        this.loaded = true;
        this.version++;
        this.changed();
      })
      .catch(() => {
        if (active.signal.aborted) return;
        this.retryAt = Date.now() + 15000;
        this.current = { ...this.current, mode: 'model', source: fallback };
        this.version++;
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
    this.current = { mode: 'checking', source: null };
    this.version++;
  }
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
