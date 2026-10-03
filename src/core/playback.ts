const SEEK_SETTLE_MS = 400;
const LOOKAHEAD_DELAY_MS = 1000;
const SEEK_JUMP_SECONDS = 1;
const SEEK_JUMP_TOLERANCE = 1e-3;
const LEAD_SECONDS = 1;

export interface PlaybackHooks {
  hold(): void;
  changed(): void;
}

export class PlaybackGate {
  private leadPending = true;
  private leadEnd = 0;
  private observedTime = Number.NaN;
  private settlesAt = 0;
  private lookaheadAt = 0;
  private seekTimer: ReturnType<typeof setTimeout> | undefined;
  private lookaheadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private hooks: PlaybackHooks) {}

  get leadUntil(): number {
    return this.leadEnd;
  }

  get settling(): boolean {
    return Date.now() < this.settlesAt;
  }

  get previewing(): boolean {
    return Date.now() < this.lookaheadAt;
  }

  observe(time: number): void {
    const previous = this.observedTime;
    this.observedTime = time;
    if (
      Number.isFinite(previous) &&
      Math.abs(time - previous) > SEEK_JUMP_SECONDS + SEEK_JUMP_TOLERANCE
    )
      this.hold();
  }

  hold(): void {
    this.leadPending = true;
    this.settlesAt = Date.now() + SEEK_SETTLE_MS;
    this.lookaheadAt = Number.POSITIVE_INFINITY;
    this.hooks.hold();
    this.clearTimers();
    this.seekTimer = setTimeout(() => this.release(), SEEK_SETTLE_MS);
  }

  restartLead(): void {
    this.leadPending = true;
  }

  lead(time: number, ready: boolean): number {
    if (ready && this.leadPending) {
      this.leadEnd = time + LEAD_SECONDS;
      this.leadPending = false;
    }
    return Math.max(time, this.leadEnd);
  }

  reset(): void {
    this.leadPending = true;
    this.observedTime = Number.NaN;
    this.settlesAt = 0;
    this.lookaheadAt = 0;
    this.clearTimers();
  }

  private release(): void {
    this.seekTimer = undefined;
    this.settlesAt = 0;
    this.lookaheadAt = Date.now() + LOOKAHEAD_DELAY_MS;
    clearTimeout(this.lookaheadTimer);
    this.lookaheadTimer = setTimeout(() => {
      this.lookaheadTimer = undefined;
      this.hooks.changed();
    }, LOOKAHEAD_DELAY_MS);
    this.hooks.changed();
  }

  private clearTimers(): void {
    clearTimeout(this.seekTimer);
    clearTimeout(this.lookaheadTimer);
    this.seekTimer = undefined;
    this.lookaheadTimer = undefined;
  }
}
