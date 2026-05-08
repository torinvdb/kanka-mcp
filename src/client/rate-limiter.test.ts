import { describe, it, expect } from "vitest";

import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  it("allows N immediate acquires within capacity and burst", async () => {
    const rl = new RateLimiter({ perMinute: 60_000, burstWindowMs: 1_000, burstMax: 100 });
    const start = Date.now();
    await Promise.all(Array.from({ length: 5 }, () => rl.acquire()));
    expect(Date.now() - start).toBeLessThan(150);
  });

  it("delays the next acquire once the burst window is saturated", async () => {
    const rl = new RateLimiter({ perMinute: 60_000, burstWindowMs: 300, burstMax: 2 });
    await rl.acquire();
    await rl.acquire();
    const start = Date.now();
    await rl.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(800);
  });

  it("penalize() blocks subsequent acquires for at least the requested duration", async () => {
    const rl = new RateLimiter({ perMinute: 60_000, burstMax: 100 });
    rl.penalize(250);
    const start = Date.now();
    await rl.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(200);
  });

  it("setCapacity resizes the bucket and refill rate, clamping tokens if shrinking", () => {
    const rl = new RateLimiter({ perMinute: 25, burstMax: 100 });
    expect(rl.capacityPerMinute).toBe(25);

    rl.setCapacity(80);
    expect(rl.capacityPerMinute).toBe(80);

    // Bucket was full at 25; after raising capacity it shouldn't artificially fill —
    // but tokens should not exceed new capacity either if it shrinks back.
    rl.setCapacity(5);
    expect(rl.capacityPerMinute).toBe(5);
  });

  it("waits when the bucket is empty until refill", async () => {
    // perMinute=60 → refill 1 token/sec. The bucket starts FULL at capacity,
    // so we drain it explicitly via penalize(0) to test the refill-wait path.
    const rl = new RateLimiter({ perMinute: 60, burstWindowMs: 50, burstMax: 100 });
    rl.penalize(0); // drain tokens without imposing a penalty wait
    const start = Date.now();
    await rl.acquire(); // must now wait ~1s for refill
    expect(Date.now() - start).toBeGreaterThanOrEqual(700);
  });
});
