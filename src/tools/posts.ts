import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context.js";
import { registerSubResourceTool } from "./subresource.js";

const PostInputSchema = z.object({
  name: z.string().min(1).max(191),
  entry: z.string().optional(),
  position: z.number().int().optional(),
  visibility_id: z.number().int().min(1).max(5).optional(),
  is_pinned: z.boolean().optional(),
  tags: z.array(z.number().int().positive()).optional(),
});

export function registerPostsTool(server: McpServer, ctx: ToolContext): void {
  registerSubResourceTool(server, ctx, {
    name: "kanka_posts",
    title: "Posts (entity notes)",
    description:
      "List, read, create, update, or delete the posts (sub-notes) attached to an entity. Posts hang off the GLOBAL entity_id, not the type-scoped id. Provide `action` plus the relevant fields: list (page), get (id), create (data), update (id, data), delete (id, confirm: true).",
    sub: "posts",
    schema: PostInputSchema,
  });
}
