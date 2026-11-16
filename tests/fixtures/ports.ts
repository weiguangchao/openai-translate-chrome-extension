import { vi } from 'vitest';

export function portPair(name: string, sender?: chrome.runtime.MessageSender) {
  const messages = [new Set<(message: unknown) => void>(), new Set<(message: unknown) => void>()];
  const disconnects = [new Set<() => void>(), new Set<() => void>()];
  let closed = false;
  const ports = [0, 1].map((index) => ({
    name,
    sender: index === 1 ? sender : undefined,
    onMessage: {
      addListener: (listener: (message: unknown) => void) => messages[index].add(listener),
      removeListener: (listener: (message: unknown) => void) => messages[index].delete(listener),
    },
    onDisconnect: {
      addListener: (listener: () => void) => disconnects[index].add(listener),
      removeListener: (listener: () => void) => disconnects[index].delete(listener),
    },
    postMessage: vi.fn((message: unknown) => {
      if (closed) throw new Error('Port disconnected');
      queueMicrotask(() => {
        for (const listener of messages[1 - index]) listener(message);
      });
    }),
    disconnect: vi.fn(() => {
      if (closed) return;
      closed = true;
      queueMicrotask(() => {
        for (const listener of disconnects[1 - index]) listener();
      });
    }),
  }));
  return {
    client: ports[0] as unknown as chrome.runtime.Port,
    server: ports[1] as unknown as chrome.runtime.Port,
  };
}
