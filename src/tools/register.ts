import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context.js";
import { registerAuthTools } from "./auth.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerDiscoveryTools } from "./discovery.js";
import { registerSearchTools } from "./search.js";
import { registerEntityTools } from "./entities.js";
import { registerPostsTool } from "./posts.js";
import { registerRelationsTool } from "./relations.js";

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerAuthTools(server, ctx);
  registerCampaignTools(server, ctx);
  registerDiscoveryTools(server, ctx);
  registerSearchTools(server, ctx);
  registerEntityTools(server, ctx);
  registerPostsTool(server, ctx);
  registerRelationsTool(server, ctx);
}
