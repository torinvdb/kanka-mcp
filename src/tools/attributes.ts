import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context.js";
import { registerSubResourceTool } from "./subresource.js";

// https://app.kanka.io/api-docs/1.0/entities/attributes
const AttributeInputSchema = z.object({
  name: z.string().min(1).max(191),
  value: z.string().nullable().optional(),
  default_order: z.number().int().min(0).optional(),
  type_id: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe(
      "1 standard, 2 multiline text, 3 checkbox, 4 section, 5 random number, 6 number, 7 list choice",
    ),
  is_private: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  api_key: z.string().max(20).optional(),
});

export function registerAttributesTool(server: McpServer, ctx: ToolContext): void {
  registerSubResourceTool(server, ctx, {
    name: "kanka_attributes",
    title: "Attributes (entity properties)",
    description:
      "List, read, create, update, or delete the attributes (Kanka calls them properties) on an entity: name/value pairs such as Height or Alignment. Attributes hang off the GLOBAL entity_id. Provide `action` plus the relevant fields: list (page), get (id), create (data), update (id, data), delete (id, confirm: true). `type_id`: 1 standard, 2 multiline, 3 checkbox, 4 section, 5 random number, 6 number, 7 list choice.",
    sub: "attributes",
    schema: AttributeInputSchema,
    slimKeys: ["id", "entity_id", "name", "value", "type_id", "is_private", "is_pinned", "default_order"],
  });
}
