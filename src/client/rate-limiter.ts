export interface RateLimiterOptions {
  perMinute: number;
  burstWindowMs?: number;
  burstMax?: number;
}

export class RateLimiter {
  private tokens: number;
  private capacity: number;
  private refillPerMs: number;
  private lastRefill: number;
  private readonly burstWindowMs: number;
  private readonly burstMax: number;
  private burstTimestamps: number[] = [];
  private readonly waiters: Array<() => void> = [];
  private penaltyUntil = 0;

  constructor(options: RateLimiterOptions) {
    this.capacity = Math.max(1, options.perMinute);
    this.tokens = this.capacity;
    this.refillPerMs = this.capacity / 60_000;
    this.lastRefill = Date.now();
    this.burstWindowMs = options.burstWindowMs ?? 1_000;
    this.burstMax = options.burstMax ?? 3;
  }

  async acquire(): Promise<void> {
    while (true) {
      this.refill();
      const now = Date.now();
      this.burstTimestamps = this.burstTimestamps.filter((t) => now - t < this.burstWindowMs);

      const penaltyWait = this.penaltyUntil - now;
      if (penaltyWait <= 0 && this.tokens >= 1 && this.burstTimestamps.length < this.burstMax) {
        this.tokens -= 1;
        this.burstTimestamps.push(now);
        return;
      }

      const tokenWaitMs =
        this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.refillPerMs);
      const burstWaitMs =
        this.burstTimestamps.length < this.burstMax
          ? 0
          : this.burstWindowMs - (now - (this.burstTimestamps[0] ?? now));
      const waitMs = Math.max(tokenWaitMs, burstWaitMs, penaltyWait, 25);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /** Drain the bucket and forbid new acquires for `ms` milliseconds. */
  penalize(ms: number): void {
    this.tokens = 0;
    const now = Date.now();
    this.penaltyUntil = Math.max(this.penaltyUntil, now + ms);
  }

  /**
   * Resize the bucket capacity. Used after we discover the user's actual tier
   * via `/profile`. Existing token count is clamped to the new capacity if
   * it shrinks; if it grows, the new headroom is available immediately.
   */
  setCapacity(perMinute: number): void {
    const next = Math.max(1, perMinute);
    if (next === this.capacity) return;
    this.capacity = next;
    this.refillPerMs = next / 60_000;
    this.tokens = Math.min(this.tokens, next);
  }

  get capacityPerMinute(): number {
    return this.capacity;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}
