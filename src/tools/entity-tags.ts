import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context.js";
import { registerSubResourceTool } from "./subresource.js";

// https://app.kanka.io/api-docs/1.0/entities/entity-tags
const EntityTagInputSchema = z.object({
  tag_id: z.number().int().positive().describe("Type-scoped id of the tag (a tag's `id`, not its entity_id)"),
});

export function registerEntityTagsTool(server: McpServer, ctx: ToolContext): void {
  registerSubResourceTool(server, ctx, {
    name: "kanka_entity_tags",
    title: "Entity tags",
    description:
      "Add or remove a single tag on an entity without rewriting its whole `tags` array (kanka_update_entity with `tags` replaces the set). Entity tags hang off the GLOBAL entity_id; `id` is the entity-tag link id returned by list, not the tag id. Actions: list (page), get (id), create (data: {tag_id}), update (id, data), delete (id, confirm: true).",
    sub: "entity_tags",
    schema: EntityTagInputSchema,
    slimKeys: ["id", "tag_id"],
  });
}
