import { describe, it, expect } from "vitest";

import { buildErrorFromResponse, KankaError } from "./errors.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("buildErrorFromResponse", () => {
  it("maps 401 to AUTH_REQUIRED", async () => {
    const err = await buildErrorFromResponse(jsonResponse(401, { message: "Unauthenticated" }));
    expect(err).toBeInstanceOf(KankaError);
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.status).toBe(401);
  });

  it("maps 403 to FORBIDDEN", async () => {
    const err = await buildErrorFromResponse(jsonResponse(403, { message: "Nope" }));
    expect(err.code).toBe("FORBIDDEN");
  });

  it("maps 404 to NOT_FOUND", async () => {
    const err = await buildErrorFromResponse(jsonResponse(404, { message: "missing" }));
    expect(err.code).toBe("NOT_FOUND");
  });

  it("maps 422 to VALIDATION_ERROR with structured field details", async () => {
    const err = await buildErrorFromResponse(
      jsonResponse(422, {
        message: "The given data was invalid.",
        errors: { name: ["The name field is required."], age: ["Must be an integer."] },
      }),
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual({
      fields: {
        name: ["The name field is required."],
        age: ["Must be an integer."],
      },
    });
  });

  it("maps 429 with Retry-After to RATE_LIMITED with retryAfterSeconds", async () => {
    const err = await buildErrorFromResponse(
      jsonResponse(429, { message: "slow down" }, { "retry-after": "12" }),
    );
    expect(err.code).toBe("RATE_LIMITED");
    expect((err.details as { retryAfterSeconds?: number }).retryAfterSeconds).toBe(12);
  });

  it("maps 500 to SERVER_ERROR", async () => {
    const err = await buildErrorFromResponse(jsonResponse(500, { message: "kaboom" }));
    expect(err.code).toBe("SERVER_ERROR");
  });

  it("maps unknown 4xx to UNKNOWN", async () => {
    const err = await buildErrorFromResponse(jsonResponse(418, { message: "I'm a teapot" }));
    expect(err.code).toBe("UNKNOWN");
  });

  it("falls back to status text when body is not JSON", async () => {
    const response = new Response("upstream offline", { status: 502 });
    const err = await buildErrorFromResponse(response);
    expect(err.code).toBe("SERVER_ERROR");
    expect(err.message).toContain("502");
  });
});
