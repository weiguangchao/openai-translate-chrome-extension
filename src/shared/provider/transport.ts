import { providerSendWindowMs, providerTimeoutMs, translationSendsPerSecond } from '../tuning';

export interface ProviderSendPolicy {
  canSend(): boolean;
  priority(): number;
  counts(): boolean;
}

interface PendingSend {
  signal?: AbortSignal;
  policy?: ProviderSendPolicy;
  start: () => void;
  cancel: () => void;
}

const pending: PendingSend[] = [];
const sentAt: { at: number; policy?: ProviderSendPolicy }[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function countedSends(): { at: number }[] {
  return sentAt.filter((sent) => sent.policy?.counts() ?? true);
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
    if (countedSends().length >= translationSendsPerSecond) break;
    if (send.policy && !send.policy.canSend()) continue;
    pending.splice(pending.indexOf(send), 1);
    send.signal?.removeEventListener('abort', send.cancel);
    send.start();
  }
  const counted = countedSends();
  if (pending.length && counted.length >= translationSendsPerSecond)
    timer = setTimeout(
      wakeProviderRequests,
      Math.max(0, providerSendWindowMs - (Date.now() - counted[0].at)),
    );
}

export function providerFetch(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  signal?: AbortSignal,
  policy?: ProviderSendPolicy,
): Promise<{ response: Response; signal: AbortSignal }> {
  const post = init.method?.toUpperCase() === 'POST';
  return new Promise((resolve, reject) => {
    const start = () => {
      try {
        signal?.throwIfAborted();
        const deadline = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(providerTimeoutMs)])
          : AbortSignal.timeout(providerTimeoutMs);
        if (post) sentAt.push({ at: Date.now(), policy });
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
