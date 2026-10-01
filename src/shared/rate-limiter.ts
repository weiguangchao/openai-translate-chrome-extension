export class RateLimiter {
  private waiting: { start: () => void }[] = [];
  private starts: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly limit: number,
    private readonly interval: number,
  ) {}

  acquire(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const entry = {
        start: () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        },
      };
      const abort = () => {
        this.waiting.splice(this.waiting.indexOf(entry), 1);
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(entry);
      this.drain();
    });
  }

  private drain(): void {
    if (this.timer !== undefined) return;
    while (this.waiting.length) {
      const now = performance.now();
      this.starts = this.starts.filter((start) => now - start < this.interval);
      if (this.starts.length >= this.limit) {
        this.timer = setTimeout(
          () => {
            this.timer = undefined;
            this.drain();
          },
          this.starts[0] + this.interval - now,
        );
        return;
      }
      this.starts.push(now);
      this.waiting.shift()!.start();
    }
  }
}
