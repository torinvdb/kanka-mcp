import { homedir } from "node:os";
import { join } from "node:path";

export type KankaTier = "free" | "subscriber";

export interface Config {
  baseUrl: string;
  oauthBaseUrl: string;
  token: string | undefined;
  tokenFilePath: string;
  oauthStoragePath: string;
  tier: KankaTier;
  rateLimitPerMin: number;
  /** True if the user explicitly set KANKA_RATE_LIMIT_PER_MIN. We won't auto-override that. */
  rateLimitExplicit: boolean;
  oauthClientId: string | undefined;
  oauthClientSecret: string | undefined;
  oauthRedirectPort: number | undefined;
  /** Per-request timeout in ms. Aborts the fetch and surfaces a NETWORK_ERROR. */
  requestTimeoutMs: number;
  /** Maximum response body size in bytes; oversized responses are rejected. */
  maxResponseBytes: number;
  logLevel: string;
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function loadConfig(): Config {
  const tier: KankaTier = process.env.KANKA_TIER === "subscriber" ? "subscriber" : "free";
  const defaultRate = tier === "subscriber" ? 80 : 25;
  return {
    baseUrl: process.env.KANKA_BASE_URL ?? "https://api.kanka.io/1.0",
    oauthBaseUrl: process.env.KANKA_OAUTH_BASE_URL ?? "https://app.kanka.io",
    token: process.env.KANKA_TOKEN,
    tokenFilePath:
      process.env.KANKA_TOKEN_FILE ?? join(homedir(), ".config", "kanka-mcp", "token"),
    oauthStoragePath:
      process.env.KANKA_OAUTH_TOKEN_FILE ??
      join(homedir(), ".config", "kanka-mcp", "oauth.json"),
    tier,
    rateLimitPerMin: envInt("KANKA_RATE_LIMIT_PER_MIN") ?? defaultRate,
    rateLimitExplicit: process.env.KANKA_RATE_LIMIT_PER_MIN !== undefined,
    oauthClientId: process.env.KANKA_OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.KANKA_OAUTH_CLIENT_SECRET,
    oauthRedirectPort: envInt("KANKA_OAUTH_REDIRECT_PORT"),
    requestTimeoutMs: envInt("KANKA_REQUEST_TIMEOUT_MS") ?? 30_000,
    maxResponseBytes: envInt("KANKA_MAX_RESPONSE_BYTES") ?? 10 * 1024 * 1024,
    logLevel: process.env.KANKA_LOG_LEVEL ?? "info",
  };
}
