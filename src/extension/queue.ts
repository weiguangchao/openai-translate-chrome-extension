import { translateBatch, translateSubtitle, translationBatchLimit } from '../shared/api';
import type { Settings } from '../shared/settings';
import {
  needsSubtitleSegmentation,
  type SubtitleTranslation,
} from '../shared/subtitle-segmentation';

interface Job {
  key: string;
  group: string;
  settings: Settings;
  text: string;
  segment: boolean;
  solo: boolean;
  promise: Promise<SubtitleTranslation>;
  resolve: (value: SubtitleTranslation) => void;
  reject: (error: Error) => void;
  controller?: AbortController;
  batch?: Job[];
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

  private group(settings: Settings): string {
    return JSON.stringify([
      settings.baseUrl,
      settings.apiKey,
      settings.apiFormat,
      settings.model,
      settings.sourceLanguage,
      settings.targetLanguage,
    ]);
  }

  private key(settings: Settings, text: string, segment: boolean): string {
    return JSON.stringify([this.group(settings), text, segment && needsSubtitleSegmentation(text)]);
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
    const job: Job = {
      key,
      group: this.group(settings),
      settings,
      text,
      segment: segment && needsSubtitleSegmentation(text),
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
      if (wanted.has(key) || (job.controller && !abortUnused)) continue;
      this.jobs.delete(key);
      job.reject(new Error('字幕已更新。'));
      if (!job.batch?.some((other) => this.jobs.get(other.key) === other)) job.controller?.abort();
    }
  }

  private drain(): void {
    const consumers = [...this.consumers.values()];
    const ordered = consumers.flatMap((state) => (state.current ? [state.current] : []));
    const due = new Set(ordered);
    for (let index = 0; index < 15; index++)
      for (const state of consumers) {
        const key = state.window[index];
        if (!key) continue;
        ordered.push(key);
        if (index < 2 * translationBatchLimit) due.add(key);
      }
    const waiting = [...new Set(ordered)].flatMap((key) => {
      const job = this.jobs.get(key);
      return job && !job.controller ? [job] : [];
    });
    while (this.active < 2 && waiting.length) {
      const [first] = waiting;
      const single = first.segment || first.solo;
      const batch = single
        ? [first]
        : waiting
            .filter((job) => !job.segment && !job.solo && job.group === first.group)
            .slice(0, translationBatchLimit);
      if (!single && batch.length < translationBatchLimit && !due.has(first.key)) break;
      for (const job of batch) waiting.splice(waiting.indexOf(job), 1);
      this.run(batch);
    }
  }

  private run(batch: Job[]): void {
    const controller = new AbortController();
    for (const job of batch) Object.assign(job, { controller, batch });
    this.active++;
    const [first] = batch;
    const work: Promise<SubtitleTranslation[] | null> =
      batch.length > 1
        ? translateBatch(
            first.settings,
            batch.map((job) => job.text),
            controller.signal,
          )
        : translateSubtitle(first.settings, first.text, controller.signal, first.segment).then(
            (result) => [result],
          );
    void work
      .then(
        (results) => {
          if (controller.signal.aborted) return;
          if (!results) {
            for (const job of batch)
              Object.assign(job, { controller: undefined, batch: undefined, solo: true });
            return;
          }
          batch.forEach((job, index) => {
            const result = results[index];
            this.cache.set(job.key, result);
            if (this.cache.size > 250) this.cache.delete(this.cache.keys().next().value!);
            const queued = this.jobs.get(job.key);
            if (queued === job || (queued && !queued.controller)) {
              this.jobs.delete(job.key);
              queued.resolve(result);
            }
            job.resolve(result);
          });
        },
        (error) => {
          if (controller.signal.aborted) return;
          this.backoffUntil = Date.now() + 15000;
          for (const [queuedKey, queued] of this.jobs) {
            if (queued.controller) continue;
            queued.reject(new Error('接口暂不可用，稍后将自动重试。'));
            this.jobs.delete(queuedKey);
          }
          for (const job of batch) {
            if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
            job.reject(error instanceof Error ? error : new Error('翻译失败。'));
          }
        },
      )
      .finally(() => {
        this.active--;
        this.drain();
      });
  }
}
