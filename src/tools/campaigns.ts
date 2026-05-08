import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";

export function registerCampaignTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "kanka_list_campaigns",
    {
      title: "List campaigns",
      description:
        "Discover which Kanka campaigns the authenticated user can access. Call this first to find the `campaign_id` you need for entity-level operations. Results are cached for 60 seconds — call again if you suspect campaigns were just created/removed in the Kanka UI.",
      inputSchema: {
        page: z.number().int().positive().optional(),
      },
    },
    async ({ page }) =>
      safeRun(async () => {
        const cacheKey = `list:${page ?? 1}`;
        let response = ctx.campaignsCache.get(cacheKey);
        if (!response) {
          response = await ctx.client.listCampaigns(page ?? 1);
          ctx.campaignsCache.set(cacheKey, response);
        }
        return jsonResult({
          campaigns: response.data.map((c) => ({
            id: c.id,
            name: c.name,
            locale: c.locale,
            visibility: c.visibility ?? c.visibility_id,
          })),
          meta: response.meta,
          links: response.links,
        });
      }),
  );

  server.registerTool(
    "kanka_get_campaign",
    {
      title: "Get campaign",
      description: "Fetch metadata for a single campaign by id.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
      },
    },
    async ({ campaign_id }) =>
      safeRun(async () => {
        const response = await ctx.client.getCampaign(campaign_id);
        return jsonResult(response.data);
      }),
  );
}
