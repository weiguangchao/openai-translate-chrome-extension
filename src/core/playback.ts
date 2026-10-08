const SEEK_SETTLE_MS = 400;
const SEEK_JUMP_SECONDS = 1;
const SEEK_JUMP_TOLERANCE = 1e-3;
const LEAD_SECONDS = 1;

export interface PlaybackHooks {
  hold(): void;
  changed(): void;
}

export class PlaybackGate {
  private leadPending = true;
  private opening = false;
  private leadEnd = 0;
  private observedTime = Number.NaN;
  private settlesAt = 0;
  private seekTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private hooks: PlaybackHooks) {}

  get leadUntil(): number {
    return this.leadEnd;
  }

  get settling(): boolean {
    return Date.now() < this.settlesAt;
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
    this.opening = false;
    this.settlesAt = Date.now() + SEEK_SETTLE_MS;
    this.hooks.hold();
    this.clearTimers();
    this.seekTimer = setTimeout(() => this.release(), SEEK_SETTLE_MS);
  }

  restartLead(): void {
    this.leadPending = true;
    this.opening = false;
  }

  lead(time: number, ready: boolean): number {
    if (ready && this.leadPending) {
      this.leadEnd = time + LEAD_SECONDS;
      this.leadPending = false;
      this.opening = true;
    }
    return Math.max(time, this.leadEnd);
  }

  consumeOpening(): boolean {
    const opening = this.opening;
    this.opening = false;
    return opening;
  }

  reset(): void {
    this.leadPending = true;
    this.opening = false;
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
