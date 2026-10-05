import { translateCaptionBatch, translationBatchLimit } from '../shared/api';
import {
  translationInput,
  type CaptionTranslation,
  type PrefetchItem,
} from '../shared/caption-translation';
import type { Settings } from '../shared/settings';

import { wakeProviderRequests } from '../shared/provider/transport';
export const translationCacheLimit = 5000;

interface Job {
  key: string;
  group: string;
  segment?: string;
  settings: Settings;
  text: string;
  needsSplit: boolean;
  solo: boolean;
  promise: Promise<CaptionTranslation>;
  resolve: (value: CaptionTranslation) => void;
  reject: (error: Error) => void;
  controller?: AbortController;
  batch?: Job[];
  sent?: boolean;
}
interface Consumer {
  current?: string;
  window: string[];
  paused?: boolean;
  held?: {
    settings: Settings;
    items: readonly PrefetchItem[];
    keys: string[];
  };
}

export class TranslationQueue {
  private jobs = new Map<string, Job>();
  private finished = new Map<string, CaptionTranslation>();
  private consumers = new Map<string, Consumer>();
  private backoffUntil = 0;
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private promoting = false;

  constructor(private cacheLimit = translationCacheLimit) {}

  private group(settings: Settings): string {
    return JSON.stringify([
      settings.baseUrl,
      settings.apiKey,
      settings.model,
      settings.sourceLanguage,
      settings.targetLanguage,
    ]);
  }

  private key(settings: Settings, text: string, needsSplit = false): string {
    return JSON.stringify([
      this.group(settings),
      text,
      translationInput(text, needsSplit).needsSplit,
    ]);
  }

  lookup(settings: Settings, text: string, needsSplit = false): Promise<CaptionTranslation | null> {
    const key = this.key(settings, text, needsSplit);
    return Promise.resolve(
      this.finished.get(key) ?? this.jobs.get(key)?.promise.catch(() => null) ?? null,
    );
  }

  request(
    consumer: string,
    settings: Settings,
    text: string,
    needsSplit = false,
  ): Promise<CaptionTranslation> {
    const key = this.key(settings, text, needsSplit);
    const state: Consumer = this.consumers.get(consumer) ?? { window: [] };
    state.current = key;
    this.consumers.set(consumer, state);
    this.prune(false);
    const finished = this.finished.get(key);
    if (finished !== undefined) return Promise.resolve(finished);
    try {
      const job = this.enqueue(key, settings, text, needsSplit);
      this.drain();
      return job.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  prefetch(
    consumer: string,
    settings: Settings,
    items: readonly PrefetchItem[],
  ): Promise<(CaptionTranslation | null)[]> {
    const keys = items.map((item) => this.key(settings, item.text, item.needsSplit));
    const state = this.consumers.get(consumer);
    if (
      keys.length &&
      state &&
      this.windowAwaitingReply(state) &&
      !keys.some((key) => state.window.includes(key))
    ) {
      state.held = { settings, items, keys };
      return this.results(keys);
    }
    if (state) state.held = undefined;
    const current = state?.current;
    if (keys.length)
      this.consumers.set(consumer, {
        current: current && keys.includes(current) ? current : undefined,
        window: keys,
        paused: state?.paused,
      });
    else this.consumers.delete(consumer);
    this.prune(true);
    if (Date.now() >= this.backoffUntil)
      items.forEach((item, index) => {
        if (!this.finished.has(keys[index]))
          this.enqueue(
            keys[index],
            settings,
            item.text,
            item.needsSplit,
            JSON.stringify([consumer, item.segment]),
          );
      });
    this.drain();
    return this.results(keys);
  }

  release(consumers: readonly string[]): void {
    for (const consumer of consumers) this.consumers.delete(consumer);
    this.prune(true);
    this.drain();
  }

  pause(consumer: string): void {
    const state = this.consumers.get(consumer);
    if (!state) return;
    state.paused = true;
    this.drain();
  }

  resume(consumer: string): void {
    const state = this.consumers.get(consumer);
    if (!state?.paused) return;
    state.paused = false;
    this.drain();
  }

  reset(): void {
    this.consumers.clear();
    this.prune(true);
    this.backoffUntil = 0;
    clearTimeout(this.sendTimer);
    this.sendTimer = undefined;
  }

  private results(keys: string[]): Promise<(CaptionTranslation | null)[]> {
    return Promise.all(
      keys.map(
        (key) => this.finished.get(key) ?? this.jobs.get(key)?.promise.catch(() => null) ?? null,
      ),
    );
  }

  private remember(key: string, translation: CaptionTranslation): void {
    this.finished.delete(key);
    this.finished.set(key, translation);
    if (this.finished.size <= this.cacheLimit) return;
    const [oldest] = this.finished.keys();
    this.finished.delete(oldest);
  }

  private enqueue(
    key: string,
    settings: Settings,
    text: string,
    needsSplit = false,
    segment?: string,
  ): Job {
    const existing = this.jobs.get(key);
    if (existing) {
      if (!existing.controller) existing.segment ??= segment;
      return existing;
    }
    if (Date.now() < this.backoffUntil) throw new Error('接口暂不可用，稍后将自动重试。');
    let resolve!: Job['resolve'], reject!: Job['reject'];
    const promise = new Promise<CaptionTranslation>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const job: Job = {
      key,
      group: this.group(settings),
      segment,
      settings,
      text,
      needsSplit: translationInput(text, needsSplit).needsSplit,
      solo: false,
      promise,
      resolve,
      reject,
    };
    this.jobs.set(key, job);
    return job;
  }

  private prune(abortUnused: boolean): void {
    const wanted = new Set(
      [...this.consumers.values()].flatMap((state) =>
        state.current ? [state.current, ...state.window] : state.window,
      ),
    );
    for (const [key, job] of this.jobs) {
      if (wanted.has(key) || (job.sent && !abortUnused)) continue;
      this.jobs.delete(key);
      job.reject(new Error('字幕已更新。'));
      if (!job.batch?.some((other) => this.jobs.get(other.key) === other)) job.controller?.abort();
    }
  }

  private windowAwaitingReply(state: Consumer): boolean {
    return state.window.some((key) => {
      const job = this.jobs.get(key);
      return Boolean(
        job && (job.solo || (job.sent && job.controller && !job.controller.signal.aborted)),
      );
    });
  }

  private parked(key: string): boolean {
    for (const state of this.consumers.values()) {
      if (!state.held || !this.windowAwaitingReply(state)) continue;
      if (state.held.keys.includes(key) && !state.window.includes(key)) return true;
    }
    return false;
  }

  private promoteHeld(): void {
    if (this.promoting || Date.now() < this.backoffUntil) return;
    this.promoting = true;
    try {
      for (const [consumer, state] of [...this.consumers]) {
        if (!state.held || this.windowAwaitingReply(state)) continue;
        const held = state.held;
        state.held = undefined;
        void this.prefetch(consumer, held.settings, held.items);
      }
    } finally {
      this.promoting = false;
    }
  }

  private drain(): void {
    this.promoteHeld();
    const consumers = [...this.consumers.values()].filter((state) => !state.paused);
    const ordered = consumers.flatMap((state) => (state.current ? [state.current] : []));
    const longest = Math.max(0, ...consumers.map((state) => state.window.length));
    for (let index = 0; index < longest; index++)
      for (const state of consumers) if (state.window[index]) ordered.push(state.window[index]);
    const waiting = [...new Set(ordered)].flatMap((key) => {
      const job = this.jobs.get(key);
      return job && !job.controller && !this.parked(key) ? [job] : [];
    });
    const now = Date.now();
    while (waiting.length && now >= this.backoffUntil) {
      const [first] = waiting;
      const batch = first.solo
        ? [first]
        : waiting
            .filter(
              (job) => !job.solo && job.group === first.group && job.segment === first.segment,
            )
            .slice(0, translationBatchLimit);
      for (const job of batch) waiting.splice(waiting.indexOf(job), 1);
      this.run(batch);
    }
    const heldReady = [...this.consumers.values()].some(
      (state) => state.held && !this.windowAwaitingReply(state),
    );
    this.scheduleSend(
      now,
      waiting.length > 0 || heldReady || [...this.jobs.values()].some((job) => !job.sent),
    );
    wakeProviderRequests();
  }

  private scheduleSend(now: number, waiting: boolean): void {
    clearTimeout(this.sendTimer);
    this.sendTimer = undefined;
    if (!waiting) return;
    const delay = Math.max(0, this.backoffUntil - now);
    if (delay === 0) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = undefined;
      this.drain();
    }, delay);
  }

  private run(batch: Job[]): void {
    const controller = new AbortController();
    for (const job of batch) Object.assign(job, { controller, batch });
    const deliver = (index: number, translation: CaptionTranslation) => {
      if (controller.signal.aborted) return;
      const job = batch[index];
      if (!job) return;
      this.remember(job.key, translation);
      if (this.jobs.get(job.key) !== job) return;
      this.jobs.delete(job.key);
      job.resolve(translation);
      this.drain();
    };
    const [first] = batch;
    const work = translateCaptionBatch(
      first.settings,
      batch.map((job) => translationInput(job.text, job.needsSplit)),
      controller.signal,
      deliver,
      {
        canSend: () => {
          if (batch.some((job) => job.sent)) return true;
          if (Date.now() < this.backoffUntil) return false;
          const wanted = [...this.consumers.values()].some(
            (state) =>
              !state.paused &&
              batch.some((job) => state.current === job.key || state.window.includes(job.key)),
          );
          if (wanted)
            batch.forEach((job) => {
              job.sent = true;
            });
          return wanted;
        },
        priority: () => {
          const consumers = [...this.consumers.values()].filter((state) => !state.paused);
          if (consumers.some((state) => batch.some((job) => job.key === state.current))) return 0;
          return (
            1 +
            Math.min(
              ...consumers.flatMap((state) =>
                batch.map((job) => {
                  const index = state.window.indexOf(job.key);
                  return index < 0 ? Infinity : index;
                }),
              ),
            )
          );
        },
      },
    );
    void work.then(
      (results) => {
        if (controller.signal.aborted) return;
        if (!results) {
          for (const job of batch) {
            if (this.jobs.get(job.key) !== job) continue;
            if (job.solo) {
              this.jobs.delete(job.key);
              job.reject(new Error('字幕断句结果无效，请稍后重试。'));
              continue;
            }
            Object.assign(job, {
              controller: undefined,
              batch: undefined,
              sent: false,
              solo: true,
            });
          }
          this.drain();
          return;
        }
        batch.forEach((job, index) => {
          const result = results[index];
          this.remember(job.key, result);
          if (this.jobs.get(job.key) !== job) return;
          this.jobs.delete(job.key);
          job.resolve(result);
        });
        this.drain();
      },
      (error) => {
        if (controller.signal.aborted) return;
        this.backoffUntil = Date.now() + 15000;
        for (const job of batch) {
          if (this.jobs.get(job.key) !== job) continue;
          this.jobs.delete(job.key);
          job.reject(error instanceof Error ? error : new Error('翻译失败。'));
        }
        this.drain();
      },
    );
  }
}
