import { providerSendWindowMs, providerTimeoutMs, translationSendsPerSecond } from '../tuning';

export interface ProviderSendPolicy {
  canSend(): boolean;
  priority(): number;
  counts(): boolean;
}

interface PendingSend {
  origin: string;
  signal?: AbortSignal;
  policy?: ProviderSendPolicy;
  start: () => void;
  cancel: () => void;
}

const pending: PendingSend[] = [];
const sentAt: { at: number; origin: string; policy?: ProviderSendPolicy }[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function countedSends(origin: string): { at: number }[] {
  return sentAt.filter((sent) => sent.origin === origin && (sent.policy?.counts() ?? true));
}

export function wakeProviderRequests(): void {
  clearTimeout(timer);
  timer = undefined;
  const now = Date.now();
  for (let index = sentAt.length - 1; index >= 0; index--)
    if (now - sentAt[index].at >= providerSendWindowMs) sentAt.splice(index, 1);
  const ordered = [...pending].sort(
    (a, b) => (a.policy?.priority() ?? 0) - (b.policy?.priority() ?? 0),
  );
  for (const send of ordered) {
    if (countedSends(send.origin).length >= translationSendsPerSecond) continue;
    if (send.policy && !send.policy.canSend()) continue;
    pending.splice(pending.indexOf(send), 1);
    send.signal?.removeEventListener('abort', send.cancel);
    send.start();
  }
  let delay = Infinity;
  for (const send of pending) {
    const counted = countedSends(send.origin);
    if (counted.length < translationSendsPerSecond) continue;
    delay = Math.min(delay, providerSendWindowMs - (now - counted[0].at));
  }
  if (Number.isFinite(delay)) timer = setTimeout(wakeProviderRequests, Math.max(0, delay));
}

export function providerFetch(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  signal?: AbortSignal,
  policy?: ProviderSendPolicy,
): Promise<{ response: Response; signal: AbortSignal }> {
  const post = init.method?.toUpperCase() === 'POST';
  const origin = new URL(url).origin;
  return new Promise((resolve, reject) => {
    const start = () => {
      try {
        signal?.throwIfAborted();
        const deadline = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(providerTimeoutMs)])
          : AbortSignal.timeout(providerTimeoutMs);
        if (post) sentAt.push({ at: Date.now(), origin, policy });
        void fetch(url, { ...init, signal: deadline }).then(
          (response) => resolve({ response, signal: deadline }),
          reject,
        );
      } catch (error) {
        reject(error);
      }
    };
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    if (!post) {
      start();
      return;
    }
    const send: PendingSend = {
      origin,
      signal,
      policy,
      start,
      cancel: () => {
        const index = pending.indexOf(send);
        if (index >= 0) pending.splice(index, 1);
        reject(signal?.reason);
        wakeProviderRequests();
      },
    };
    pending.push(send);
    signal?.addEventListener('abort', send.cancel, { once: true });
    wakeProviderRequests();
  });
}
