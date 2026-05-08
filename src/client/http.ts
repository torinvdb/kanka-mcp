import { logger } from "../logger.js";
import { buildErrorFromResponse, KankaError } from "./errors.js";
import { RateLimiter } from "./rate-limiter.js";

export interface TokenSource {
  getToken(): Promise<string | undefined>;
  /** Optional: invoked after a 401 so OAuth providers can attempt a single-flight refresh. */
  onUnauthorized?(): Promise<boolean>;
}

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface HttpClientOptions {
  /** Per-request timeout (ms). Default 30_000. */
  timeoutMs?: number;
  /** Hard cap on response body bytes; rejects oversized responses. Default 10 MiB. */
  maxResponseBytes?: number;
}

export class HttpClient {
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    private readonly baseUrl: string,
    private readonly auth: TokenSource,
    private readonly rateLimiter: RateLimiter,
    options: HttpClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 10 * 1024 * 1024;
  }

  async request<T>(opts: HttpRequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const method = opts.method ?? "GET";

    let attempt = 0;
    let refreshed = false;
    while (true) {
      attempt += 1;
      await this.rateLimiter.acquire();

      const token = await this.auth.getToken();
      if (!token) {
        throw new KankaError("AUTH_REQUIRED", "No Kanka API token configured");
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
      let body: string | undefined;
      if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.body);
      }

      const timeoutCtl = new AbortController();
      const timer = setTimeout(() => timeoutCtl.abort(), this.timeoutMs);
      const signal = opts.signal
        ? AbortSignal.any([timeoutCtl.signal, opts.signal])
        : timeoutCtl.signal;

      let response: Response;
      try {
        response = await fetch(url, { method, headers, body, signal });
      } catch (cause) {
        clearTimeout(timer);
        const err = cause as Error & { name?: string };
        if (err?.name === "AbortError" && timeoutCtl.signal.aborted) {
          throw new KankaError(
            "NETWORK_ERROR",
            `Request timed out after ${this.timeoutMs}ms`,
            { cause },
          );
        }
        throw new KankaError("NETWORK_ERROR", `Network error: ${err?.message ?? String(cause)}`, {
          cause,
        });
      }
      clearTimeout(timer);

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await this.readBoundedText(response);
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      }

      if (response.status === 401 && !refreshed && this.auth.onUnauthorized) {
        const ok = await this.auth.onUnauthorized();
        refreshed = true;
        if (ok) continue;
      }

      const err = await buildErrorFromResponse(response);

      if (err.code === "RATE_LIMITED" && attempt <= 3) {
        const retryAfter =
          (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ??
          Math.min(60, 2 ** attempt);
        logger.warn({ retryAfter, attempt }, "Rate limited; backing off");
        this.rateLimiter.penalize(retryAfter * 1000);
        continue;
      }

      throw err;
    }
  }

  private async readBoundedText(response: Response): Promise<string> {
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      throw new KankaError(
        "SERVER_ERROR",
        `Response declared ${declared} bytes, exceeds limit of ${this.maxResponseBytes}`,
        { status: response.status },
      );
    }
    const reader = response.body?.getReader();
    if (!reader) return response.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxResponseBytes) {
        try {
          await reader.cancel();
        } catch {
          /* best effort */
        }
        throw new KankaError(
          "SERVER_ERROR",
          `Response body exceeded ${this.maxResponseBytes} bytes`,
          { status: response.status },
        );
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
  }

  private buildUrl(path: string, query?: HttpRequestOptions["query"]): string {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}
