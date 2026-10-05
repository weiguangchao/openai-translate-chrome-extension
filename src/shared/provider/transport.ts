export const translationSendsPerSecond = 3;
const sendWindowMs = 1000;

interface PendingSend {
  signal?: AbortSignal;
  canSend: () => boolean;
  start: () => void;
  cancel: () => void;
}

const pending: PendingSend[] = [];
let sentAt: number[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export function wakeProviderRequests(): void {
  clearTimeout(timer);
  timer = undefined;
  const now = Date.now();
  sentAt = sentAt.filter((at) => now - at < sendWindowMs);
  for (const send of [...pending]) {
    if (sentAt.length >= translationSendsPerSecond) break;
    if (!send.canSend()) continue;
    pending.splice(pending.indexOf(send), 1);
    send.signal?.removeEventListener('abort', send.cancel);
    sentAt.push(now);
    send.start();
  }
  if (pending.length && sentAt.length >= translationSendsPerSecond)
    timer = setTimeout(wakeProviderRequests, sendWindowMs - (now - sentAt[0]));
}

export function providerFetch(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  signal?: AbortSignal,
  canSend: () => boolean = () => true,
): Promise<{ response: Response; signal: AbortSignal }> {
  return new Promise((resolve, reject) => {
    const start = () => {
      try {
        signal?.throwIfAborted();
        const deadline = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000);
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
    if (init.method !== 'POST') {
      start();
      return;
    }
    const send: PendingSend = {
      signal,
      canSend,
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
