export function createChromeEvent<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    addListener(listener: (...args: Args) => void) {
      listeners.add(listener);
    },
    removeListener(listener: (...args: Args) => void) {
      listeners.delete(listener);
    },
    emit(...args: Args) {
      for (const listener of listeners) listener(...args);
    },
  };
}
