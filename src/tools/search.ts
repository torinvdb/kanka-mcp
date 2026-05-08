import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ENTITY_TYPES } from "../schemas/index.js";
import { fullTextSearch } from "../services/full-text-search.js";
import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";

export function registerSearchTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "kanka_search",
    {
      title: "Name search",
      description:
        "Find entities by NAME within a campaign — fast, server-side, but matches names only (no entry/body text). Prefer this when you know the entity name. For matching against entry text, use kanka_full_text_search instead. For listing/browsing, use kanka_list_entities.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        query: z.string().min(1),
        types: z.array(z.enum(ENTITY_TYPES)).optional(),
        page: z.number().int().positive().optional(),
      },
    },
    async ({ campaign_id, query, types, page }) =>
      safeRun(async () => {
        const response = await ctx.client.search(campaign_id, query, page ?? 1);
        let results = response.data;
        if (types && types.length > 0) {
          const allowed = new Set(types);
          results = results.filter((r) => allowed.has(r.type as (typeof types)[number]));
        }
        for (const r of results) {
          ctx.idResolver.remember({
            campaignId: campaign_id,
            entityId: r.entity_id,
            type: r.type as (typeof ENTITY_TYPES)[number],
            typeId: r.id,
            name: r.name,
          });
        }
        return jsonResult({
          results: results.map((r) => ({
            entity_id: r.entity_id,
            id: r.id,
            type: r.type,
            name: r.name,
            tooltip: r.tooltip,
            url: r.url,
            is_private: r.is_private,
          })),
          meta: response.meta,
        });
      }),
  );

  server.registerTool(
    "kanka_full_text_search",
    {
      title: "Full-text search (client-side)",
      description:
        "Search across the body text (entry HTML) of entities by paginating typed list endpoints, stripping HTML, and matching locally. Costs API budget — narrow `types` and lower `max_pages_per_type` to keep it cheap. Returns matches with a snippet around the hit.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        query: z.string().min(1),
        types: z.array(z.enum(ENTITY_TYPES)).optional(),
        max_pages_per_type: z.number().int().positive().max(67).optional(),
        per_page: z.number().int().positive().max(100).optional(),
        limit: z.number().int().positive().max(200).optional(),
        case_sensitive: z.boolean().optional(),
        regex: z.boolean().optional(),
      },
    },
    async ({ campaign_id, query, types, max_pages_per_type, per_page, limit, case_sensitive, regex }) =>
      safeRun(async () => {
        const report = await fullTextSearch(ctx.client, {
          campaignId: campaign_id,
          query,
          types,
          maxPagesPerType: max_pages_per_type,
          perPage: per_page,
          limit,
          caseSensitive: case_sensitive,
          regex,
        });
        for (const m of report.matches) {
          ctx.idResolver.remember({
            campaignId: campaign_id,
            entityId: m.entity_id,
            type: m.type,
            typeId: m.id,
            name: m.name,
          });
        }
        return jsonResult(report);
      }),
  );
}
