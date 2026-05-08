import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context.js";
import { registerSubResourceTool } from "./subresource.js";

const RelationInputSchema = z.object({
  relation: z.string().min(1).max(191).describe("Free-form relation label, e.g. 'ally' or 'parent'"),
  target_id: z.number().int().positive().describe("entity_id of the related entity"),
  attitude: z.number().int().min(-100).max(100).optional(),
  colour: z
    .string()
    .regex(/^#?[0-9a-fA-F]{3,8}$/, "Expected a hex colour like #ff0000")
    .optional(),
  two_way: z.boolean().optional(),
  visibility_id: z.number().int().min(1).max(5).optional(),
  is_pinned: z.boolean().optional(),
});

export function registerRelationsTool(server: McpServer, ctx: ToolContext): void {
  registerSubResourceTool(server, ctx, {
    name: "kanka_relations",
    title: "Relations between entities",
    description:
      "List, read, create, update, or delete relations between entities. Relations hang off the GLOBAL entity_id of the source. The `target_id` in `data` is the global entity_id of the destination. Set `two_way: true` to create reciprocal relations.",
    sub: "relations",
    schema: RelationInputSchema,
  });
}
