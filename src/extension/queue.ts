import { t } from '../shared/i18n';
import { translateCaptionBatch } from '../shared/api';
import { latencySampleLimit, translationBatchLimit } from '../shared/tuning';
import {
  planPlayback,
  slackSeconds,
  typicalLatency,
  type PlaybackCue,
} from '../shared/playback-plan';
import { ProviderTimeoutError, RepeatedSourceError } from '../shared/provider-error';
import { wakeProviderRequests } from '../shared/provider/transport';
import { translationIdentity, type CaptionTranslationSettings } from '../shared/settings';
import type { TraceEvent } from '../shared/trace';

export const translationCacheLimit = 5000;

export interface TranslationStore {
  save(key: string, translation: string): void;
  remove(key: string): void;
}

interface Job {
  key: string;
  consumer: string;
  settings: CaptionTranslationSettings;
  text: string;
  pack?: string;
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  controller?: AbortController;
  batch?: Job[];
  sent?: boolean;
  cache: boolean;
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
  private finished = new Map<string, string>();
  private preview = new Map<string, string>();
  private consumers = new Map<string, Consumer>();
  private backoff: { until: number; error: Error } | undefined;
  private failed = new Map<string, Error>();
  private detached = new WeakSet<AbortController>();
  private samples: number[] = [];
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private batches = 0;
  private store: TranslationStore | undefined;

  constructor(
    private cacheLimit = translationCacheLimit,
    private trace: (event: TraceEvent) => void = () => {},
  ) {}

  private key(settings: CaptionTranslationSettings, text: string): string {
    return JSON.stringify([...translationIdentity(settings), text]);
  }

  restore(entries: Iterable<readonly [string, string]>, store: TranslationStore): void {
    for (const [key, translation] of entries)
      if (!this.finished.has(key)) this.finished.set(key, translation);
    this.store = store;
    this.evict();
  }

  lookup(settings: CaptionTranslationSettings, text: string): Promise<string | null> {
    const key = this.key(settings, text);
    return Promise.resolve(
      this.finished.get(key) ?? this.jobs.get(key)?.promise.catch(() => null) ?? null,
    );
  }

  request(
    consumer: string,
    settings: CaptionTranslationSettings,
    text: string,
    options?: { cache?: boolean },
  ): Promise<string> {
    const key = this.key(settings, text);
    const state: Consumer = this.consumers.get(consumer) ?? {
      packs: [],
      snapshot: [],
      time: 0,
      rate: 1,
    };
    state.current = key;
    state.held = false;
    this.consumers.set(consumer, state);
    this.prune('keep');
    this.retainFailed();
    const finished = this.finished.get(key) ?? this.preview.get(key);
    if (finished !== undefined) return Promise.resolve(finished);
    const failure = this.failed.get(key);
    if (failure) return Promise.reject(failure);
    try {
      const job = this.enqueue(key, settings, text, consumer, { cache: options?.cache });
      this.drain();
      return job.promise;
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(t('翻译失败。', 'Translation failed.')),
      );
    }
  }

  cached(settings: CaptionTranslationSettings, text: string): boolean {
    return this.finished.has(this.key(settings, text));
  }

  hasPrefetch(consumer: string): boolean {
    return (this.consumers.get(consumer)?.packs.length ?? 0) > 0;
  }

  prefetch(
    consumer: string,
    settings: CaptionTranslationSettings,
    cues: readonly PlaybackCue[],
    time = 0,
    rate = 1,
    options?: { cache?: boolean },
  ): Promise<(string | null)[]> {
    if (!cues.length) {
      this.consumers.delete(consumer);
      this.prune('abort');
      this.retainFailed();
      this.drain();
      return Promise.resolve([]);
    }
    const state = this.consumers.get(consumer);
    const snapshot = cues.map((cue) => ({
      key: this.key(settings, cue.text),
      cue,
    }));
    const open = snapshot.filter(
      ({ key }) =>
        !this.finished.has(key) &&
        !this.preview.has(key) &&
        !this.failed.has(key) &&
        !this.jobs.get(key)?.controller,
    );
    const planned = planPlayback({
      time,
      rate,
      cues: open.map(({ cue }) => cue),
      samples: this.samples,
    });
    const packs: Pack[] = planned.map((request) => ({
      id: `${consumer}:${request.cues[0].start}:${request.cues[0].text}`,
      keys: request.cues.map((cue) => this.key(settings, cue.text)),
      cues: request.cues,
    }));
    const current = cues.some(
      (cue) =>
        cue.start <= time && time < cue.end && this.key(settings, cue.text) === state?.current,
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
    this.prune('abort');
    this.retainFailed();
    if (Date.now() >= (this.backoff?.until ?? 0))
      planned.forEach((request, index) => {
        const pack = packs[index];
        request.cues.forEach((cue, cueIndex) => {
          const key = pack.keys[cueIndex];
          if (this.finished.has(key) || this.preview.has(key) || this.failed.has(key)) return;
          const job = this.enqueue(key, settings, cue.text, consumer, {
            pack: pack.id,
            cache: options?.cache,
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
    this.prune('detach');
    this.retainFailed();
    this.drain();
  }

  release(consumers: readonly string[]): void {
    for (const consumer of consumers) this.consumers.delete(consumer);
    this.prune('abort');
    this.retainFailed();
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
    this.prune('abort');
    this.backoff = undefined;
    this.failed.clear();
    this.preview.clear();
    clearTimeout(this.sendTimer);
    this.sendTimer = undefined;
  }

  private results(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(
      keys.map(
        (key) =>
          this.finished.get(key) ??
          this.preview.get(key) ??
          this.jobs.get(key)?.promise.catch(() => null) ??
          null,
      ),
    );
  }

  private retainFailed(): void {
    const live = new Set<string>();
    for (const state of this.consumers.values()) {
      if (state.current) live.add(state.current);
      for (const { key } of state.snapshot) live.add(key);
    }
    for (const key of this.failed.keys()) if (!live.has(key)) this.failed.delete(key);
    for (const key of this.preview.keys()) if (!live.has(key)) this.preview.delete(key);
  }

  private remember(job: Job, translation: string): void {
    if (!job.cache) {
      this.preview.set(job.key, translation);
      return;
    }
    this.finished.delete(job.key);
    this.finished.set(job.key, translation);
    this.store?.save(job.key, translation);
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
    settings: CaptionTranslationSettings,
    text: string,
    consumer: string,
    options?: { pack?: string; cache?: boolean },
  ): Job {
    const existing = this.jobs.get(key);
    if (existing) {
      if (!existing.controller) {
        if (options?.pack) existing.pack = options.pack;
      }
      return existing;
    }
    if (this.backoff && Date.now() < this.backoff.until) throw this.backoff.error;
    let resolve!: Job['resolve'], reject!: Job['reject'];
    const promise = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const job: Job = {
      key,
      consumer,
      settings,
      text,
      ...(options?.pack ? { pack: options.pack } : {}),
      promise,
      resolve,
      reject,
      cache: options?.cache !== false,
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

  private prune(sent: 'keep' | 'abort' | 'detach'): void {
    const wanted = this.wanted();
    for (const [key, job] of this.jobs) {
      if (wanted.has(key) || (job.sent && sent === 'keep')) continue;
      this.jobs.delete(key);
      job.reject(new Error(t('字幕已更新。', 'Subtitles have changed.')));
      if (job.batch?.some((other) => this.jobs.get(other.key) === other)) continue;
      if (job.sent && sent === 'detach' && job.controller) this.detached.add(job.controller);
      else job.controller?.abort();
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
    while (waiting.length && now >= (this.backoff?.until ?? 0)) {
      const first = waiting[0];
      const batch = !first.pack
        ? [first]
        : waiting.filter((job) => job.pack === first.pack).slice(0, translationBatchLimit);
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
    const delay = Math.max(0, (this.backoff?.until ?? 0) - now);
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
    const reject = (failure: Error) => {
      for (const job of batch) {
        if (this.jobs.get(job.key) !== job) continue;
        this.jobs.delete(job.key);
        this.failed.set(job.key, failure);
        job.reject(failure);
      }
      this.drain();
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
    const deliver = (index: number, translation: string) => {
      if (controller.signal.aborted) return;
      if (!delivered) {
        delivered = true;
        this.trace({ e: 'first', id, ms: elapsed() });
      }
      const job = batch[index];
      if (!job) return;
      this.remember(job, translation);
      if (this.jobs.get(job.key) !== job) return;
      this.jobs.delete(job.key);
      job.resolve(translation);
      this.drain();
    };
    const work = translateCaptionBatch(
      first.settings,
      batch.map((job) => job.text),
      controller.signal,
      deliver,
      {
        canSend: () => {
          if (batch.some((job) => job.sent)) return true;
          if (this.backoff && Date.now() < this.backoff.until) return false;
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
        counts: () => !this.detached.has(controller),
      },
    );
    void work.then(
      (results) => {
        if (controller.signal.aborted) return finish('aborted');
        finish(results ? 'ok' : 'invalid');
        if (!results) {
          reject(
            new Error(
              t(
                'Provider 回复非法信息流，无法翻译',
                'Provider returned an invalid response stream. Unable to translate.',
              ),
            ),
          );
          return;
        }
        batch.forEach((job, index) => {
          const result = results[index];
          this.remember(job, result);
          if (this.jobs.get(job.key) !== job) return;
          this.jobs.delete(job.key);
          job.resolve(result);
        });
        this.drain();
      },
      (error) => {
        if (controller.signal.aborted) return finish('aborted');
        if (error instanceof RepeatedSourceError) {
          finish('invalid');
          reject(error);
          return;
        }
        const failure =
          error instanceof Error ? error : new Error(t('翻译失败。', 'Translation failed.'));
        const timedOut = failure instanceof ProviderTimeoutError;
        finish(timedOut ? 'timeout' : 'error');
        if (!timedOut) {
          this.backoff = { until: Date.now() + 15000, error: failure };
        }
        reject(failure);
      },
    );
  }
}

export class HybridTranslationQueue {
  private readonly microsoft: TranslationQueue;
  private readonly openai: TranslationQueue;
  private readonly microsoftStopped = new Set<string>();

  constructor(
    cacheLimit = translationCacheLimit,
    trace: (event: TraceEvent) => void = () => {},
    private readonly microsoftAllowed: () => boolean = () => true,
  ) {
    this.microsoft = new TranslationQueue(cacheLimit, trace);
    this.openai = new TranslationQueue(cacheLimit, trace);
  }

  restore(entries: Iterable<readonly [string, string]>, store: TranslationStore): void {
    const microsoft: (readonly [string, string])[] = [];
    const openai: (readonly [string, string])[] = [];
    for (const entry of entries) {
      const provider = translationProvider(entry[0]);
      if (provider === 'microsoft') microsoft.push(entry);
      if (provider === 'openai') openai.push(entry);
    }
    this.microsoft.restore(microsoft, store);
    this.openai.restore(openai, store);
  }

  lookup(settings: CaptionTranslationSettings, text: string): Promise<string | null> {
    const queue = settings.provider === 'microsoft' ? this.microsoft : this.openai;
    return queue.lookup(settings, text);
  }

  request(consumer: string, settings: CaptionTranslationSettings, text: string): Promise<string> {
    if (settings.provider === 'microsoft') return this.microsoft.request(consumer, settings, text);
    if (this.openai.cached(settings, text)) return this.openai.request(consumer, settings, text);
    const microsoftSettings = { ...settings, provider: 'microsoft' as const };
    const openai = this.openai.request(consumer, settings, text).then((translation) => {
      if (!this.openai.hasPrefetch(consumer)) this.stopMicrosoft(consumer);
      return translation;
    });
    const microsoft =
      this.microsoftAllowed() && !this.microsoftStopped.has(consumer)
        ? this.microsoft.request(consumer, microsoftSettings, text, { cache: false })
        : Promise.reject(new Error('Microsoft fallback is not authorized.'));
    return firstTranslation(openai, microsoft);
  }

  prefetch(
    consumer: string,
    settings: CaptionTranslationSettings,
    cues: readonly PlaybackCue[],
    time = 0,
    rate = 1,
  ): Promise<(string | null)[]> {
    if (settings.provider === 'microsoft')
      return this.microsoft.prefetch(consumer, settings, cues, time, rate);
    const microsoftSettings = { ...settings, provider: 'microsoft' as const };
    const uncached = cues.filter((cue) => !this.openai.cached(settings, cue.text));
    const openai = this.openai.prefetch(consumer, settings, cues, time, rate);
    const microsoft =
      !uncached.length || !this.microsoftAllowed() || this.microsoftStopped.has(consumer)
        ? Promise.resolve<(string | null)[]>([])
        : this.microsoft.prefetch(consumer, microsoftSettings, uncached, time, rate, {
            cache: false,
          });
    return Promise.all([openai, microsoft]).then(([openaiResults, microsoftResults]) => {
      if (openaiResults.length && openaiResults.every((translation) => translation !== null))
        this.stopMicrosoft(consumer);
      const fallback = new Map(uncached.map((cue, index) => [cue, microsoftResults[index]]));
      return cues.map((cue, index) => openaiResults[index] ?? fallback.get(cue) ?? null);
    });
  }

  hold(consumer: string, time: number): void {
    this.microsoftStopped.delete(consumer);
    this.microsoft.hold(consumer, time);
    this.openai.hold(consumer, time);
  }

  pause(consumer: string): void {
    this.microsoft.pause(consumer);
    this.openai.pause(consumer);
  }

  resume(consumer: string): void {
    this.microsoft.resume(consumer);
    this.openai.resume(consumer);
  }

  release(consumers: readonly string[]): void {
    this.microsoft.release(consumers);
    this.openai.release(consumers);
    for (const consumer of consumers) this.microsoftStopped.delete(consumer);
  }

  reset(): void {
    this.microsoft.reset();
    this.openai.reset();
    this.microsoftStopped.clear();
  }

  disableMicrosoft(): void {
    this.microsoft.reset();
    this.microsoftStopped.clear();
  }

  private stopMicrosoft(consumer: string): void {
    if (this.microsoftStopped.has(consumer)) return;
    this.microsoftStopped.add(consumer);
    this.microsoft.hold(consumer, 0);
  }
}

function firstTranslation(first: Promise<string>, second: Promise<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    let rejected = 0;
    let firstError: unknown;
    const settle = (promise: Promise<string>, remember: (error: unknown) => void) =>
      promise.then(resolve, (error) => {
        remember(error);
        rejected += 1;
        if (rejected === 2) reject(firstError ?? error);
      });
    settle(first, (error) => {
      firstError = error;
    });
    settle(second, () => {});
  });
}

function translationProvider(key: string): 'microsoft' | 'openai' | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed)) return null;
    return parsed[0] === 'microsoft' || parsed[0] === 'openai' ? parsed[0] : null;
  } catch {
    return null;
  }
}
