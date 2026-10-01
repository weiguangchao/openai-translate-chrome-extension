import { translateSubtitle } from '../shared/api';
import type { Settings } from '../shared/settings';
import {
  needsSubtitleSegmentation,
  type SubtitleTranslation,
} from '../shared/subtitle-segmentation';

interface Job {
  settings: Settings;
  text: string;
  segment: boolean;
  promise: Promise<SubtitleTranslation>;
  resolve: (value: SubtitleTranslation) => void;
  reject: (error: Error) => void;
  controller?: AbortController;
}
interface Consumer {
  current?: string;
  window: string[];
}

export class TranslationQueue {
  private active = 0;
  private jobs = new Map<string, Job>();
  private consumers = new Map<string, Consumer>();
  private cache = new Map<string, SubtitleTranslation>();
  private backoffUntil = 0;

  private key(settings: Settings, text: string, segment: boolean): string {
    return JSON.stringify([
      settings.baseUrl,
      settings.apiKey,
      settings.apiFormat,
      settings.model,
      settings.prompt,
      settings.sourceLanguage,
      settings.targetLanguage,
      text,
      segment && needsSubtitleSegmentation(text),
    ]);
  }

  request(
    consumer: string,
    settings: Settings,
    text: string,
    segment = false,
  ): Promise<SubtitleTranslation> {
    const key = this.key(settings, text, segment);
    const state: Consumer = this.consumers.get(consumer) ?? { window: [] };
    state.current = key;
    this.consumers.set(consumer, state);
    this.prune(false);
    const cached = this.cache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    try {
      const job = this.enqueue(key, settings, text, segment);
      this.drain();
      return job.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  prefetch(consumer: string, settings: Settings, texts: string[], segment = false): void {
    const keys = texts.map((text) => this.key(settings, text, segment));
    const current = this.consumers.get(consumer)?.current;
    if (keys.length)
      this.consumers.set(consumer, {
        current: current && keys.includes(current) ? current : undefined,
        window: keys,
      });
    else this.consumers.delete(consumer);
    this.prune(true);
    try {
      texts.forEach((text, index) => {
        if (!this.cache.has(keys[index])) this.enqueue(keys[index], settings, text, segment);
      });
    } finally {
      this.drain();
    }
  }

  reset(): void {
    this.consumers.clear();
    this.prune(true);
    this.cache.clear();
    this.backoffUntil = 0;
  }

  private enqueue(key: string, settings: Settings, text: string, segment: boolean): Job {
    const existing = this.jobs.get(key);
    if (existing) return existing;
    if (Date.now() < this.backoffUntil) throw new Error('接口暂不可用，稍后将自动重试。');
    if (this.jobs.size >= 32) throw new Error('翻译任务过多，请稍后重试。');
    let resolve!: Job['resolve'], reject!: Job['reject'];
    const promise = new Promise<SubtitleTranslation>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const job = { settings, text, segment, promise, resolve, reject };
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
      if (wanted.has(key) || (job.controller && !abortUnused)) continue;
      this.jobs.delete(key);
      job.controller?.abort();
      job.reject(new Error('字幕已更新。'));
    }
  }

  private drain(): void {
    const consumers = [...this.consumers.values()];
    const ordered = consumers.flatMap((state) => (state.current ? [state.current] : []));
    for (let index = 0; index < 12; index++)
      for (const state of consumers) if (state.window[index]) ordered.push(state.window[index]);
    for (const key of ordered) {
      if (this.active >= 2) break;
      const job = this.jobs.get(key);
      if (!job || job.controller) continue;
      job.controller = new AbortController();
      this.active++;
      void translateSubtitle(job.settings, job.text, job.controller.signal, job.segment)
        .then(
          (result) => {
            if (job.controller!.signal.aborted) return;
            this.cache.set(key, result);
            if (this.cache.size > 250) this.cache.delete(this.cache.keys().next().value!);
            job.resolve(result);
          },
          (error) => {
            if (job.controller!.signal.aborted) return;
            this.backoffUntil = Date.now() + 15000;
            for (const [queuedKey, queued] of this.jobs) {
              if (queued.controller) continue;
              queued.reject(new Error('接口暂不可用，稍后将自动重试。'));
              this.jobs.delete(queuedKey);
            }
            job.reject(error instanceof Error ? error : new Error('翻译失败。'));
          },
        )
        .finally(() => {
          if (this.jobs.get(key) === job) this.jobs.delete(key);
          this.active--;
          this.drain();
        });
    }
  }
}
