import { describe, it, expect, vi } from "vitest";

import type { KankaClient } from "../client/client.js";
import { KankaError } from "../client/errors.js";
import { RateLimiter } from "../client/rate-limiter.js";
import { ProfileService } from "./profile.js";

function makeRateLimiter(perMinute = 25): RateLimiter {
  return new RateLimiter({ perMinute, burstMax: 100 });
}

function fakeClient(impl: () => Promise<{ data: unknown }> | { data: unknown }) {
  return { getProfile: vi.fn(async () => impl()) } as unknown as KankaClient;
}

describe("ProfileService", () => {
  it("auto-tunes the rate limiter to the reported subscriber rate_limit", async () => {
    const rl = makeRateLimiter(25);
    const client = fakeClient(() => ({
      data: { id: 1, name: "Tester", is_subscriber: true, rate_limit: 90 },
    }));

    const svc = new ProfileService(client, rl, { rateLimitExplicit: false });
    const result = await svc.ensure();

    expect(result?.is_subscriber).toBe(true);
    expect(rl.capacityPerMinute).toBe(90);
  });

  it("respects an explicit KANKA_RATE_LIMIT_PER_MIN by NOT overriding the limiter", async () => {
    const rl = makeRateLimiter(10);
    const client = fakeClient(() => ({
      data: { id: 1, name: "Tester", is_subscriber: true, rate_limit: 90 },
    }));

    const svc = new ProfileService(client, rl, { rateLimitExplicit: true });
    await svc.ensure();

    expect(rl.capacityPerMinute).toBe(10);
  });

  it("is single-flight: concurrent ensure() calls share one HTTP request", async () => {
    const rl = makeRateLimiter(25);
    const client = fakeClient(() => ({
      data: { id: 1, name: "Tester", is_subscriber: false, rate_limit: 30 },
    }));

    const svc = new ProfileService(client, rl, { rateLimitExplicit: false });
    await Promise.all([svc.ensure(), svc.ensure(), svc.ensure()]);

    expect(client.getProfile).toHaveBeenCalledTimes(1);
  });

  it("swallows AUTH_REQUIRED so the server keeps running", async () => {
    const rl = makeRateLimiter(25);
    const client = fakeClient(async () => {
      throw new KankaError("AUTH_REQUIRED", "no token");
    });
    const svc = new ProfileService(client, rl, { rateLimitExplicit: false });

    const result = await svc.ensure();
    expect(result).toBeUndefined();
    expect(rl.capacityPerMinute).toBe(25); // unchanged
  });

  it("reset() lets a subsequent ensure() retry after a failure", async () => {
    const rl = makeRateLimiter(25);
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      if (calls === 1) throw new KankaError("AUTH_REQUIRED", "no token");
      return { data: { id: 1, name: "Tester", is_subscriber: true, rate_limit: 90 } };
    });
    const svc = new ProfileService(client, rl, { rateLimitExplicit: false });

    await svc.ensure();
    expect(rl.capacityPerMinute).toBe(25);

    svc.reset();
    await svc.ensure();
    expect(rl.capacityPerMinute).toBe(90);
  });
});
