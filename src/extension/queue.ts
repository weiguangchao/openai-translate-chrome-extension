import { translateCaptionBatch, translationBatchLimit } from '../shared/api';
import { translationInput, type CaptionTranslation } from '../shared/caption-translation';
import { latencySampleLimit, maxInFlightRequests } from '../shared/limits';
import {
  planPlayback,
  slackSeconds,
  typicalLatency,
  type PlaybackCue,
} from '../shared/playback-plan';
import { ProviderTimeoutError } from '../shared/provider-error';
import { wakeProviderRequests } from '../shared/provider/transport';
import type { Settings } from '../shared/settings';
import type { TraceEvent } from '../shared/trace';

export const translationCacheLimit = 5000;

export interface TranslationStore {
  save(key: string, translation: CaptionTranslation): void;
  remove(key: string): void;
}

interface Job {
  key: string;
  consumer: string;
  settings: Settings;
  text: string;
  needsSplit: boolean;
  solo: boolean;
  pack?: string;
  promise: Promise<CaptionTranslation>;
  resolve: (value: CaptionTranslation) => void;
  reject: (error: Error) => void;
  controller?: AbortController;
  batch?: Job[];
  sent?: boolean;
}

interface Pack {
  id: string;
  keys: string[];
  cues: readonly PlaybackCue[];
}

interface SnapshotCue {
  key: string;
  cue: PlaybackCue;
}

interface Consumer {
  current?: string;
  packs: Pack[];
  snapshot: readonly SnapshotCue[];
  paused?: boolean;
  held?: boolean;
  time: number;
  rate: number;
}

export class TranslationQueue {
  private jobs = new Map<string, Job>();
  private finished = new Map<string, CaptionTranslation>();
  private consumers = new Map<string, Consumer>();
  private backoffUntil = 0;
  private backoffReason = '';
  private expired = new Set<string>();
  private samples: number[] = [];
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private batches = 0;
  private store: TranslationStore | undefined;

  constructor(
    private cacheLimit = translationCacheLimit,
    private trace: (event: TraceEvent) => void = () => {},
  ) {}

  private key(settings: Settings, text: string, needsSplit = false): string {
    return JSON.stringify([
      settings.baseUrl,
      settings.model,
      settings.sourceLanguage,
      settings.targetLanguage,
      text,
      translationInput(text, needsSplit).needsSplit,
    ]);
  }

  restore(entries: Iterable<readonly [string, CaptionTranslation]>, store: TranslationStore): void {
    for (const [key, translation] of entries)
      if (!this.finished.has(key)) this.finished.set(key, translation);
    this.store = store;
    this.evict();
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
    const state: Consumer = this.consumers.get(consumer) ?? {
      packs: [],
      snapshot: [],
      time: 0,
      rate: 1,
    };
    state.current = key;
    state.held = false;
    this.consumers.set(consumer, state);
    this.prune(false);
    this.retainExpired();
    const finished = this.finished.get(key);
    if (finished !== undefined) return Promise.resolve(finished);
    if (this.expired.has(key)) return Promise.reject(new ProviderTimeoutError());
    try {
      const job = this.enqueue(key, settings, text, needsSplit, consumer);
      this.drain();
      return job.promise;
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('翻译失败。'));
    }
  }

  prefetch(
    consumer: string,
    settings: Settings,
    cues: readonly PlaybackCue[],
    time = 0,
    rate = 1,
  ): Promise<(CaptionTranslation | null)[]> {
    if (!cues.length) {
      this.consumers.delete(consumer);
      this.prune(true);
      this.retainExpired();
      this.drain();
      return Promise.resolve([]);
    }
    const state = this.consumers.get(consumer);
    const snapshot = cues.map((cue) => ({
      key: this.key(settings, cue.text, cue.needsSplit),
      cue,
    }));
    const open = snapshot.filter(
      ({ key }) =>
        !this.finished.has(key) && !this.expired.has(key) && !this.jobs.get(key)?.controller,
    );
    const planned = planPlayback({
      time,
      rate,
      cues: open.map(({ cue }) => cue),
      samples: this.samples,
    });
    const packs: Pack[] = planned.map((request) => ({
      id: `${consumer}:${request.cues[0].start}:${request.cues[0].text}`,
      keys: request.cues.map((cue) => this.key(settings, cue.text, cue.needsSplit)),
      cues: request.cues,
    }));
    const current = cues.some(
      (cue) =>
        cue.start <= time &&
        time < cue.end &&
        this.key(settings, cue.text, cue.needsSplit) === state?.current,
    )
      ? state?.current
      : undefined;
    this.consumers.set(consumer, {
      current,
      packs,
      snapshot,
      paused: state?.paused,
      time,
      rate,
    });
    this.prune(true);
    this.retainExpired();
    if (Date.now() >= this.backoffUntil)
      planned.forEach((request, index) => {
        const pack = packs[index];
        request.cues.forEach((cue, cueIndex) => {
          const key = pack.keys[cueIndex];
          if (this.finished.has(key) || this.expired.has(key)) return;
          const job = this.enqueue(key, settings, cue.text, cue.needsSplit, consumer, {
            pack: pack.id,
          });
          if (!job.controller) job.pack = pack.id;
        });
      });
    this.drain();
    return this.results(snapshot.map(({ key }) => key));
  }

  hold(consumer: string, time: number): void {
    const state = this.consumers.get(consumer);
    if (!state) return;
    state.time = time;
    state.current = undefined;
    state.held = true;
    state.packs = [];
    state.snapshot = state.snapshot.filter(
      ({ key, cue }) => cue.start <= time && time < cue.end && this.jobs.get(key)?.sent,
    );
    this.prune(true);
    this.retainExpired();
    this.drain();
  }

  release(consumers: readonly string[]): void {
    for (const consumer of consumers) this.consumers.delete(consumer);
    this.prune(true);
    this.retainExpired();
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
    this.samples = [];
    this.prune(true);
    this.backoffUntil = 0;
    this.backoffReason = '';
    this.expired.clear();
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

  private retainExpired(): void {
    const live = new Set<string>();
    for (const state of this.consumers.values()) {
      if (state.current) live.add(state.current);
      for (const { key } of state.snapshot) live.add(key);
    }
    for (const key of this.expired) if (!live.has(key)) this.expired.delete(key);
  }

  private remember(key: string, translation: CaptionTranslation): void {
    this.finished.delete(key);
    this.finished.set(key, translation);
    this.store?.save(key, translation);
    this.evict();
  }

  private evict(): void {
    while (this.finished.size > this.cacheLimit) {
      const [oldest] = this.finished.keys();
      this.finished.delete(oldest);
      this.store?.remove(oldest);
    }
  }

  private noteSample(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > latencySampleLimit * 4)
      this.samples.splice(0, this.samples.length - latencySampleLimit * 4);
  }

  private enqueue(
    key: string,
    settings: Settings,
    text: string,
    needsSplit: boolean,
    consumer: string,
    options?: { pack: string },
  ): Job {
    const existing = this.jobs.get(key);
    if (existing) {
      if (!existing.controller) {
        if (options?.pack) existing.pack = options.pack;
      }
      return existing;
    }
    if (Date.now() < this.backoffUntil) throw new Error(this.backoffReason);
    let resolve!: Job['resolve'], reject!: Job['reject'];
    const promise = new Promise<CaptionTranslation>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const job: Job = {
      key,
      consumer,
      settings,
      text,
      needsSplit: translationInput(text, needsSplit).needsSplit,
      solo: false,
      ...(options?.pack ? { pack: options.pack } : {}),
      promise,
      resolve,
      reject,
    };
    this.jobs.set(key, job);
    return job;
  }

  private wanted(): Set<string> {
    return new Set(
      [...this.consumers.values()].flatMap((state) => [
        ...(state.current ? [state.current] : []),
        ...state.snapshot.map(({ key }) => key),
      ]),
    );
  }

  private prune(abortUnused: boolean): void {
    const wanted = this.wanted();
    for (const [key, job] of this.jobs) {
      if (wanted.has(key) || (job.sent && !abortUnused)) continue;
      this.jobs.delete(key);
      job.reject(new Error('字幕已更新。'));
      if (!job.batch?.some((other) => this.jobs.get(other.key) === other)) job.controller?.abort();
    }
  }

  private inFlight(): number {
    const seen = new Set<AbortController>();
    for (const job of this.jobs.values())
      if (job.controller && !job.controller.signal.aborted) seen.add(job.controller);
    return seen.size;
  }

  private drain(): void {
    const consumers = [...this.consumers.values()].filter((state) => !state.paused && !state.held);
    const ordered = consumers.flatMap((state) => (state.current ? [state.current] : []));
    for (const state of consumers) for (const pack of state.packs) ordered.push(...pack.keys);
    const waiting = [...new Set(ordered)].flatMap((key) => {
      const job = this.jobs.get(key);
      return job && !job.controller ? [job] : [];
    });
    const now = Date.now();
    while (waiting.length && now >= this.backoffUntil && this.inFlight() < maxInFlightRequests) {
      const first = waiting[0];
      const batch =
        first.solo || !first.pack
          ? [first]
          : waiting
              .filter((job) => !job.solo && job.pack === first.pack)
              .slice(0, translationBatchLimit);
      for (const job of batch) waiting.splice(waiting.indexOf(job), 1);
      this.run(batch);
    }
    this.scheduleSend(now, waiting.length > 0 || [...this.jobs.values()].some((job) => !job.sent));
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
    const [first] = batch;
    const id = ++this.batches;
    const created = Date.now();
    let sentAt: number | undefined;
    let delivered = false;
    const state = this.consumers.get(first.consumer);
    const time = state?.time ?? 0;
    const rate = state?.rate ?? 1;
    const pack = state?.packs.find((item) => item.id === first.pack);
    const cues =
      pack?.cues.filter((_, index) => batch.some((job) => job.key === pack.keys[index])) ?? [];
    const start = cues.length ? Math.min(...cues.map((cue) => cue.start)) : time;
    const end = cues.length ? Math.max(...cues.map((cue) => cue.end)) : time;
    const slack = slackSeconds(start, time, rate);
    const predictedMs = typicalLatency(this.samples);
    const elapsed = () => Date.now() - (sentAt ?? created);
    const finish = (result: 'ok' | 'invalid' | 'timeout' | 'error' | 'aborted') => {
      if (result === 'ok' && sentAt !== undefined) this.noteSample(elapsed());
      this.trace({ e: 'done', id, ms: elapsed(), result });
    };
    this.trace({
      e: 'batch',
      id,
      tab: first.consumer,
      size: batch.length,
      videoTime: time,
      playbackRate: rate,
      start,
      end,
      predictedMs,
      slack: Math.round(slack * 100) / 100,
      inFlight: this.inFlight(),
      blocked: false,
      atRisk: predictedMs > Math.max(0, slack) * 1000,
    });
    const deliver = (index: number, translation: CaptionTranslation) => {
      if (controller.signal.aborted) return;
      if (!delivered) {
        delivered = true;
        this.trace({ e: 'first', id, ms: elapsed() });
      }
      const job = batch[index];
      if (!job) return;
      this.remember(job.key, translation);
      if (this.jobs.get(job.key) !== job) return;
      this.jobs.delete(job.key);
      job.resolve(translation);
      this.drain();
    };
    const work = translateCaptionBatch(
      first.settings,
      batch.map((job) => translationInput(job.text, job.needsSplit)),
      controller.signal,
      deliver,
      {
        canSend: () => {
          if (batch.some((job) => job.sent)) return true;
          if (Date.now() < this.backoffUntil) return false;
          const live = [...this.consumers.values()].some(
            (item) =>
              !item.paused &&
              !item.held &&
              batch.some(
                (job) =>
                  item.current === job.key || item.snapshot.some(({ key }) => key === job.key),
              ),
          );
          if (live) {
            batch.forEach((job) => {
              job.sent = true;
            });
            sentAt = Date.now();
            this.trace({ e: 'sent', id });
          }
          return batch.some((job) => job.sent);
        },
        priority: () => {
          const consumers = [...this.consumers.values()].filter((item) => !item.paused);
          if (consumers.some((item) => batch.some((job) => job.key === item.current))) return 0;
          return 1;
        },
      },
    );
    void work.then(
      (results) => {
        if (controller.signal.aborted) return finish('aborted');
        finish(results ? 'ok' : 'invalid');
        if (!results) {
          for (const job of batch) {
            if (this.jobs.get(job.key) !== job) continue;
            if (job.solo) {
              this.jobs.delete(job.key);
              job.reject(new Error('模型返回的译文无效，请稍后重试。'));
              continue;
            }
            Object.assign(job, {
              controller: undefined,
              batch: undefined,
              sent: false,
              solo: true,
              pack: undefined,
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
        if (controller.signal.aborted) return finish('aborted');
        const failure = error instanceof Error ? error : new Error('翻译失败。');
        const timedOut = failure instanceof ProviderTimeoutError;
        finish(timedOut ? 'timeout' : 'error');
        if (!timedOut) {
          this.backoffUntil = Date.now() + 15000;
          this.backoffReason = failure.message || '翻译失败。';
        }
        for (const job of batch) {
          if (this.jobs.get(job.key) !== job) continue;
          if (timedOut) this.expired.add(job.key);
          this.jobs.delete(job.key);
          job.reject(failure);
        }
        this.drain();
      },
    );
  }
}
