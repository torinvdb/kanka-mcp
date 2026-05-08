import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ENTITY_TYPES, describeEntityType } from "../schemas/index.js";
import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";

export function registerDiscoveryTools(server: McpServer, _ctx: ToolContext): void {
  server.registerTool(
    "kanka_describe_entity_type",
    {
      title: "Describe entity type",
      description:
        "Return the JSON Schema for the create/update payload of a Kanka entity type. Call this before kanka_create_entity or kanka_update_entity to discover required and optional fields.",
      inputSchema: {
        entity_type: z.enum(ENTITY_TYPES),
      },
    },
    async ({ entity_type }) =>
      safeRun(async () => {
        return jsonResult(describeEntityType(entity_type));
      }),
  );
}
