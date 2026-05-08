import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

import type { TokenSource } from "./http.js";
import { HttpClient } from "./http.js";
import { KankaError } from "./errors.js";
import { RateLimiter } from "./rate-limiter.js";

const BASE = "https://api.kanka.io/1.0";

function makeAuth(token: string | undefined, onUnauth?: () => Promise<boolean>): TokenSource {
  return {
    getToken: async () => token,
    onUnauthorized: onUnauth,
  };
}

function makeClient(auth: TokenSource): HttpClient {
  return new HttpClient(BASE, auth, new RateLimiter({ perMinute: 60_000, burstMax: 100 }));
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("HttpClient", () => {
  it("performs a successful GET and parses JSON", async () => {
    server.use(
      http.get(`${BASE}/campaigns/1`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer test-token");
        return HttpResponse.json({ data: { id: 1, name: "Tolria" } });
      }),
    );
    const client = makeClient(makeAuth("test-token"));
    const result = await client.request<{ data: { id: number } }>({ path: "campaigns/1" });
    expect(result.data.id).toBe(1);
  });

  it("encodes query params correctly", async () => {
    server.use(
      http.get(`${BASE}/campaigns/1/characters`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("page")).toBe("3");
        expect(url.searchParams.get("name")).toBe("Aragorn");
        return HttpResponse.json({ data: [] });
      }),
    );
    const client = makeClient(makeAuth("t"));
    await client.request<unknown>({
      path: "campaigns/1/characters",
      query: { page: 3, name: "Aragorn", undef: undefined },
    });
  });

  it("throws AUTH_REQUIRED when no token is configured", async () => {
    const client = makeClient(makeAuth(undefined));
    await expect(client.request({ path: "campaigns" })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("maps 422 to VALIDATION_ERROR with structured fields", async () => {
    server.use(
      http.post(`${BASE}/campaigns/1/notes`, () =>
        HttpResponse.json(
          { message: "The given data was invalid.", errors: { name: ["required"] } },
          { status: 422 },
        ),
      ),
    );
    const client = makeClient(makeAuth("t"));
    await expect(
      client.request({ method: "POST", path: "campaigns/1/notes", body: {} }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { fields: { name: ["required"] } },
    });
  });

  it("invokes onUnauthorized() once on 401 and retries", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/campaigns`, () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: "expired" }, { status: 401 });
        return HttpResponse.json({ data: [] });
      }),
    );
    const onUnauth = vi.fn(async () => true);
    const client = makeClient(makeAuth("t", onUnauth));
    const result = await client.request<{ data: unknown[] }>({ path: "campaigns" });
    expect(result.data).toEqual([]);
    expect(onUnauth).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it("does not loop forever when refresh fails", async () => {
    server.use(http.get(`${BASE}/campaigns`, () => HttpResponse.json({}, { status: 401 })));
    const onUnauth = vi.fn(async () => false);
    const client = makeClient(makeAuth("t", onUnauth));
    await expect(client.request({ path: "campaigns" })).rejects.toBeInstanceOf(KankaError);
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 (with short Retry-After) and succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/campaigns`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { message: "slow down" },
            { status: 429, headers: { "retry-after": "0" } },
          );
        }
        return HttpResponse.json({ data: [] });
      }),
    );
    const client = makeClient(makeAuth("t"));
    const result = await client.request<{ data: unknown[] }>({ path: "campaigns" });
    expect(result.data).toEqual([]);
    expect(calls).toBe(2);
  });

  it("propagates lastSync as a query param and exposes the returned sync token", async () => {
    server.use(
      http.get(`${BASE}/campaigns/1/characters`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("lastSync")).toBe("2026-05-08T12:00:00Z");
        return HttpResponse.json({
          data: [{ id: 1, entity_id: 100, name: "Aragorn" }],
          sync: "2026-05-08T18:30:00Z",
        });
      }),
    );
    const client = makeClient(makeAuth("t"));
    const result = await client.request<{ data: unknown[]; sync: string }>({
      path: "campaigns/1/characters",
      query: { lastSync: "2026-05-08T12:00:00Z" },
    });
    expect(result.sync).toBe("2026-05-08T18:30:00Z");
  });

  it("aborts the request when the configured timeout elapses", async () => {
    server.use(
      http.get(`${BASE}/campaigns`, async () => {
        await new Promise((r) => setTimeout(r, 1500));
        return HttpResponse.json({ data: [] });
      }),
    );
    const client = new HttpClient(
      BASE,
      makeAuth("t"),
      new RateLimiter({ perMinute: 60_000, burstMax: 100 }),
      { timeoutMs: 200 },
    );
    await expect(client.request({ path: "campaigns" })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringMatching(/timed out/i),
    });
  });

  it("rejects responses whose Content-Length exceeds maxResponseBytes", async () => {
    const huge = "x".repeat(50_000);
    server.use(
      http.get(`${BASE}/campaigns`, () =>
        new HttpResponse(huge, {
          status: 200,
          headers: { "content-type": "application/json", "content-length": String(huge.length) },
        }),
      ),
    );
    const client = new HttpClient(
      BASE,
      makeAuth("t"),
      new RateLimiter({ perMinute: 60_000, burstMax: 100 }),
      { maxResponseBytes: 1024 },
    );
    await expect(client.request({ path: "campaigns" })).rejects.toMatchObject({
      code: "SERVER_ERROR",
      message: expect.stringContaining("exceeds limit"),
    });
  });

  it("returns undefined for 204 No Content", async () => {
    server.use(
      http.delete(`${BASE}/campaigns/1/notes/5`, () => new HttpResponse(null, { status: 204 })),
    );
    const client = makeClient(makeAuth("t"));
    const result = await client.request<void>({
      method: "DELETE",
      path: "campaigns/1/notes/5",
    });
    expect(result).toBeUndefined();
  });
});
