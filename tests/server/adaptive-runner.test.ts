import { describe, expect, it } from "vitest";
import { AdaptiveRunner } from "../../server/engine/adaptive-runner";

/** Fake clock: sleep advances virtual time so cooldowns resolve deterministically. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

const notRateLimited = () => false as const;
const isRl = (e: unknown) => ((e as Error).message === "rl" ? null : false);

describe("AdaptiveRunner (AIMD concurrency)", () => {
  it("additively increases the limit after a streak of successes", async () => {
    const c = fakeClock();
    const r = new AdaptiveRunner({ max: 6, initial: 2, increaseEvery: 2, ...c });
    expect(r.limit).toBe(2);
    await r.run(async () => "ok", notRateLimited);
    expect(r.limit).toBe(2); // 1 success, not yet
    await r.run(async () => "ok", notRateLimited);
    expect(r.limit).toBe(3); // 2 successes -> +1
  });

  it("never exceeds max", async () => {
    const c = fakeClock();
    const r = new AdaptiveRunner({ max: 3, initial: 1, increaseEvery: 1, ...c });
    for (let i = 0; i < 10; i++) await r.run(async () => "ok", notRateLimited);
    expect(r.limit).toBe(3);
  });

  it("halves the limit and retries the task on a rate-limit, then succeeds", async () => {
    const c = fakeClock();
    const r = new AdaptiveRunner({ max: 8, initial: 4, defaultCooldownMs: 100, ...c });
    let calls = 0;
    const result = await r.run(async () => {
      calls += 1;
      if (calls === 1) throw new Error("rl");
      return "ok";
    }, isRl);
    expect(result).toBe("ok");
    expect(calls).toBe(2); // failed once, retried
    expect(r.limit).toBe(2); // 4 -> 2
    expect(r.backoffs).toBe(1);
  });

  it("gives up after maxRateLimitRetries and propagates the error", async () => {
    const c = fakeClock();
    const r = new AdaptiveRunner({ max: 8, initial: 4, maxRateLimitRetries: 2, ...c });
    await expect(r.run(async () => { throw new Error("rl"); }, isRl)).rejects.toThrow("rl");
    expect(r.backoffs).toBe(2);
    expect(r.limit).toBe(1); // 4 -> 2 -> 1
  });

  it("never runs more than `limit` tasks concurrently", async () => {
    const c = fakeClock();
    const r = new AdaptiveRunner({ max: 2, initial: 2, increaseEvery: 1000, ...c });
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      await Promise.resolve();
      active -= 1;
      return "ok";
    };
    await Promise.all(Array.from({ length: 6 }, () => r.run(task, notRateLimited)));
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("non-rate-limit errors propagate immediately (no retry)", async () => {
    const c = fakeClock();
    const r = new AdaptiveRunner({ max: 4, ...c });
    let calls = 0;
    await expect(
      r.run(async () => { calls += 1; throw new Error("boom"); }, isRl),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
    expect(r.backoffs).toBe(0);
  });
});
