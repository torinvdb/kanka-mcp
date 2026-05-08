import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";

export function registerAuthTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "kanka_auth_status",
    {
      title: "Kanka auth status",
      description:
        "Check whether the server has a usable Kanka credential and where it came from (env var, token file, OAuth, or none). Call this first if other tools return AUTH_REQUIRED — it'll tell you what's missing.",
      inputSchema: {},
    },
    async () =>
      safeRun(async () => {
        const status = await ctx.auth.status();
        // Trigger /profile detection if we haven't already; await it so the
        // returned status reflects the user's tier on the first call.
        let profile = ctx.profile.get();
        if (!profile && status.authenticated) {
          profile = await ctx.profile.ensure();
        }
        return jsonResult({
          ...status,
          profile: profile
            ? {
                id: profile.id,
                name: profile.name,
                is_subscriber: profile.is_subscriber,
                rate_limit: profile.rate_limit,
              }
            : undefined,
        });
      }),
  );

  server.registerTool(
    "kanka_oauth_login",
    {
      title: "OAuth login",
      description:
        "Run the OAuth 2.0 Authorization Code flow with PKCE. Opens a browser to the Kanka authorize page; on approval, persists access + refresh tokens to disk so subsequent tool calls authenticate transparently. Requires an OAuth app registered at https://app.kanka.io/settings/api?clients=1. Provide client_id/client_secret here or via KANKA_OAUTH_CLIENT_ID / KANKA_OAUTH_CLIENT_SECRET env vars.",
      inputSchema: {
        client_id: z.string().optional(),
        client_secret: z.string().optional(),
      },
    },
    async ({ client_id, client_secret }) =>
      safeRun(async () => {
        const result = await ctx.auth.login({
          clientId: client_id,
          clientSecret: client_secret,
        });
        // After fresh login, retry /profile detection so the rate limiter
        // re-tunes for whichever account just authenticated.
        ctx.profile.reset();
        await ctx.profile.ensure().catch(() => undefined);
        return jsonResult(result);
      }),
  );

  server.registerTool(
    "kanka_auth_logout",
    {
      title: "OAuth logout",
      description:
        "Clear stored OAuth tokens (access + refresh). Personal API token configured via env or file is unaffected.",
      inputSchema: {},
    },
    async () =>
      safeRun(async () => {
        ctx.auth.logout();
        return jsonResult({ ok: true });
      }),
  );
}
