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
  private jobs = new Map<string, Job>();
  private consumers = new Map<string, Consumer>();
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
        this.enqueue(keys[index], settings, text, segment);
      });
    } finally {
      this.drain();
    }
  }

  reset(): void {
    this.consumers.clear();
    this.prune(true);
    this.backoffUntil = 0;
  }

  private enqueue(key: string, settings: Settings, text: string, segment: boolean): Job {
    const existing = this.jobs.get(key);
    if (existing) return existing;
    if (Date.now() < this.backoffUntil) throw new Error('接口暂不可用，稍后将自动重试。');
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
    const longest = Math.max(0, ...consumers.map((state) => state.window.length));
    for (let index = 0; index < longest; index++)
      for (const state of consumers) if (state.window[index]) ordered.push(state.window[index]);
    const waiting = [...new Set(ordered)].flatMap((key) => {
      const job = this.jobs.get(key);
      return job && !job.controller ? [job] : [];
    });
    while (waiting.length) {
      const [first] = waiting;
      const batch =
        first.segment || first.solo
          ? [first]
          : waiting
              .filter((job) => !job.segment && !job.solo && job.group === first.group)
              .slice(0, translationBatchLimit);
      for (const job of batch) waiting.splice(waiting.indexOf(job), 1);
      this.run(batch);
    }
  }

  private run(batch: Job[]): void {
    const controller = new AbortController();
    for (const job of batch) Object.assign(job, { controller, batch });
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
    void work.then(
      (results) => {
        if (controller.signal.aborted) return;
        if (!results) {
          for (const job of batch)
            Object.assign(job, { controller: undefined, batch: undefined, solo: true });
          this.drain();
          return;
        }
        batch.forEach((job, index) => {
          const result = results[index];
          if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
          job.resolve(result);
        });
      },
      (error) => {
        if (controller.signal.aborted) return;
        this.backoffUntil = Date.now() + 15000;
        for (const job of batch) {
          if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
          job.reject(error instanceof Error ? error : new Error('翻译失败。'));
        }
      },
    );
  }
}
