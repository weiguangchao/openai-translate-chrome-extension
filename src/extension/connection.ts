interface Reply<T> {
  ok?: boolean;
  data?: T;
  error?: string;
}

export class ExtensionConnection {
  private invalidated = false;

  constructor(private onInvalidated: () => void) {}

  get active(): boolean {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) this.invalidate();
    return !this.invalidated;
  }

  async sendMessage<T = unknown>(message: unknown): Promise<Reply<T>> {
    try {
      const response = await Promise.resolve().then(() => {
        if (!this.active) throw new Error('Extension context invalidated.');
        return chrome.runtime.sendMessage(message);
      });
      if (!this.active) throw new Error('Extension context invalidated.');
      return response;
    } catch (error) {
      if (
        !this.active ||
        (error instanceof Error && /extension context invalidated/i.test(error.message))
      )
        this.invalidate();
      throw error;
    }
  }

  private invalidate(): void {
    if (this.invalidated) return;
    this.invalidated = true;
    this.onInvalidated();
  }
}
