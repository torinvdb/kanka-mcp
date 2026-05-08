import type { KankaClient, KankaProfile } from "../client/client.js";
import { KankaError } from "../client/errors.js";
import type { RateLimiter } from "../client/rate-limiter.js";
import { logger } from "../logger.js";

export interface ProfileServiceOptions {
  /** When true, /profile's reported rate_limit will NOT override the local rate limiter. */
  rateLimitExplicit: boolean;
}

/**
 * Fetches /profile once and uses the response to:
 *   1. Auto-detect the user's tier (free vs subscriber) via `is_subscriber`.
 *   2. Resize the rate limiter to match the server-reported `rate_limit`,
 *      unless the user explicitly set KANKA_RATE_LIMIT_PER_MIN.
 *
 * Idempotent and single-flight: concurrent calls share the same in-flight fetch.
 * Failures (auth missing, network error) are swallowed — the rate limiter just
 * stays on its conservative default.
 */
export class ProfileService {
  private cached: KankaProfile | undefined;
  private fetchPromise: Promise<KankaProfile | undefined> | undefined;
  private failed = false;

  constructor(
    private readonly client: KankaClient,
    private readonly rateLimiter: RateLimiter,
    private readonly options: ProfileServiceOptions,
  ) {}

  get(): KankaProfile | undefined {
    return this.cached;
  }

  async ensure(): Promise<KankaProfile | undefined> {
    if (this.cached) return this.cached;
    if (this.failed) return undefined;
    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = (async () => {
      try {
        const response = await this.client.getProfile();
        this.cached = response.data;
        if (!this.options.rateLimitExplicit && response.data.rate_limit > 0) {
          const before = this.rateLimiter.capacityPerMinute;
          this.rateLimiter.setCapacity(response.data.rate_limit);
          if (before !== response.data.rate_limit) {
            logger.info(
              {
                from: before,
                to: response.data.rate_limit,
                is_subscriber: response.data.is_subscriber,
              },
              "Auto-tuned rate limiter from /profile",
            );
          }
        }
        return response.data;
      } catch (err) {
        // Don't crash the server if /profile is inaccessible — just log and
        // stick with the configured rate limit. Most likely cause: not
        // authenticated yet (AUTH_REQUIRED), in which case we'll naturally
        // try again later when the user logs in.
        if (err instanceof KankaError && err.code === "AUTH_REQUIRED") {
          logger.debug("Skipping /profile fetch: not authenticated yet");
        } else {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "Could not fetch /profile; rate limit auto-tuning unavailable",
          );
        }
        this.failed = true;
        return undefined;
      } finally {
        this.fetchPromise = undefined;
      }
    })();

    return this.fetchPromise;
  }

  /** Reset the failure latch so the next ensure() retries (e.g., after fresh login). */
  reset(): void {
    this.failed = false;
    this.cached = undefined;
  }
}
