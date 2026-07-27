/**
 * Adaptive concurrency limiter (AIMD — additive-increase / multiplicative-decrease, like
 * TCP congestion control). Runs tasks with at most `limit` in flight; `limit` grows by 1
 * after a streak of successes and halves on a rate-limit signal, then pauses for a cooldown.
 * This keeps the AI request rate as high as the provider allows without tipping into 429s —
 * no hand-set concurrency, no silent rate-limit losses.
 *
 * The clock and sleep are injectable so the AIMD logic is unit-testable without real timers.
 */
export interface AdaptiveRunnerOptions {
  /** Hard ceiling on concurrency. */
  max: number;
  /** Floor (never drops below). Default 1. */
  min?: number;
  /** Starting concurrency. Default min(4, max). */
  initial?: number;
  /** Successful calls between each +1 increase. Default 10. */
  increaseEvery?: number;
  /** Per-task rate-limit retries before giving up. Default 6. */
  maxRateLimitRetries?: number;
  /** Cooldown used when the provider gives no Retry-After. Default 1000ms. */
  defaultCooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Returns the retry-after ms (or null) when `err` is a rate-limit; `false` otherwise. */
export type RateLimitProbe = (err: unknown) => number | null | false;

export class AdaptiveRunner {
  limit: number;
  peak: number;
  backoffs = 0;
  private readonly min: number;
  private readonly max: number;
  private readonly increaseEvery: number;
  private readonly maxRateLimitRetries: number;
  private readonly defaultCooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private inFlight = 0;
  private successStreak = 0;
  private cooldownUntil = 0;
  private waiters: Array<() => void> = [];

  constructor(opts: AdaptiveRunnerOptions) {
    this.max = Math.max(1, Math.floor(opts.max));
    this.min = Math.min(this.max, Math.max(1, Math.floor(opts.min ?? 1)));
    this.limit = Math.min(this.max, Math.max(this.min, Math.floor(opts.initial ?? Math.min(4, this.max))));
    this.peak = this.limit;
    this.increaseEvery = Math.max(1, opts.increaseEvery ?? 10);
    this.maxRateLimitRetries = Math.max(0, opts.maxRateLimitRetries ?? 6);
    this.defaultCooldownMs = opts.defaultCooldownMs ?? 1000;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async acquire(): Promise<void> {
    for (;;) {
      const wait = this.cooldownUntil - this.now();
      if (wait > 0) await this.sleep(wait);
      if (this.inFlight < this.limit && this.now() >= this.cooldownUntil) {
        this.inFlight++;
        return;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.waiters.shift()?.();
  }

  private wakeAll(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  private onSuccess(): void {
    if (this.limit >= this.max) return;
    if (++this.successStreak >= this.increaseEvery) {
      this.limit = Math.min(this.max, this.limit + 1);
      this.peak = Math.max(this.peak, this.limit);
      this.successStreak = 0;
      this.wakeAll(); // the new slot may let a waiter proceed
    }
  }

  private onRateLimit(retryAfterMs: number | null): void {
    this.limit = Math.max(this.min, Math.floor(this.limit / 2));
    this.successStreak = 0;
    this.backoffs++;
    this.cooldownUntil = this.now() + (retryAfterMs ?? this.defaultCooldownMs);
  }

  /**
   * Run `task` under the adaptive limit. Rate-limit failures (per `isRateLimit`) shrink the
   * limit, pause, and retry the task; any other error propagates to the caller.
   */
  async run<T>(task: () => Promise<T>, isRateLimit: RateLimitProbe): Promise<T> {
    let retries = 0;
    for (;;) {
      await this.acquire();
      try {
        const result = await task();
        this.onSuccess();
        return result;
      } catch (err) {
        const retryAfter = isRateLimit(err);
        if (retryAfter !== false && retries < this.maxRateLimitRetries) {
          this.onRateLimit(retryAfter);
          retries++;
          continue; // release() runs in finally, then re-acquire after the cooldown
        }
        throw err;
      } finally {
        this.release();
      }
    }
  }
}
