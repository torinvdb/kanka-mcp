import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createAuthProvider } from "./auth/index.js";
import { KankaClient, type CampaignSummary } from "./client/client.js";
import { HttpClient } from "./client/http.js";
import { RateLimiter } from "./client/rate-limiter.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { TtlCache } from "./services/cache.js";
import { IdResolver } from "./services/id-resolver.js";
import { ProfileService } from "./services/profile.js";
import { registerAllTools } from "./tools/register.js";
import type { KankaListResponse } from "./types.js";

export interface BuildServerResult {
  server: McpServer;
}

export function buildServer(): BuildServerResult {
  const config = loadConfig();
  logger.info(
    { tier: config.tier, rateLimitPerMin: config.rateLimitPerMin, baseUrl: config.baseUrl },
    "Initializing kanka-mcp",
  );

  const auth = createAuthProvider(config);
  const rateLimiter = new RateLimiter({ perMinute: config.rateLimitPerMin });
  const http = new HttpClient(config.baseUrl, auth, rateLimiter, {
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
  const client = new KankaClient(http);
  const idResolver = new IdResolver(client);
  const campaignsCache = new TtlCache<string, KankaListResponse<CampaignSummary>>(60_000);
  const profile = new ProfileService(client, rateLimiter, {
    rateLimitExplicit: config.rateLimitExplicit,
  });

  // Fire-and-forget: try to detect tier on startup. Safe to fail silently —
  // the rate limiter stays on its conservative default if /profile is
  // unavailable or unauthenticated.
  void profile.ensure().catch(() => undefined);

  const server = new McpServer(
    { name: "kanka-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Kanka MCP server. Authenticate via the KANKA_TOKEN env var (Personal API token from app.kanka.io/settings/api). Call kanka_list_campaigns to discover available campaigns, then operate on entities scoped to a chosen campaign_id. For unfamiliar entity types, call kanka_describe_entity_type before constructing create/update payloads.",
    },
  );

  registerAllTools(server, { auth, client, idResolver, campaignsCache, profile });

  return { server };
}
