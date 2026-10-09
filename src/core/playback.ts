export const seekSettleMs = 400;
export const seekJumpSeconds = 1;
const SEEK_JUMP_TOLERANCE = 1e-3;

export interface PlaybackHooks {
  hold(): void;
  changed(): void;
}

export class PlaybackGate {
  private observedTime = Number.NaN;
  private settlesAt = 0;
  private seekTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private hooks: PlaybackHooks) {}

  get settling(): boolean {
    return Date.now() < this.settlesAt;
  }

  observe(time: number): void {
    const previous = this.observedTime;
    this.observedTime = time;
    if (
      Number.isFinite(previous) &&
      Math.abs(time - previous) > seekJumpSeconds + SEEK_JUMP_TOLERANCE
    )
      this.hold();
  }

  hold(): void {
    this.settlesAt = Date.now() + seekSettleMs;
    this.hooks.hold();
    this.clearTimers();
    this.seekTimer = setTimeout(() => this.release(), seekSettleMs);
  }

  reset(): void {
    this.observedTime = Number.NaN;
    this.settlesAt = 0;
    this.clearTimers();
  }

  private release(): void {
    this.seekTimer = undefined;
    this.settlesAt = 0;
    this.hooks.changed();
  }

  private clearTimers(): void {
    clearTimeout(this.seekTimer);
    this.seekTimer = undefined;
  }
}
