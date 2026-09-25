import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context.js";
import { withCallLogging } from "./call-log.js";
import { registerAuthTools } from "./auth.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerDiscoveryTools } from "./discovery.js";
import { registerSearchTools } from "./search.js";
import { registerEntityTools } from "./entities.js";
import { registerPostsTool } from "./posts.js";
import { registerRelationsTool } from "./relations.js";
import { registerAttributesTool } from "./attributes.js";
import { registerEntityTagsTool } from "./entity-tags.js";
import { registerOrganisationMembersTool } from "./organisation-members.js";
import { registerEntityImageTool } from "./entity-image.js";

export function registerAllTools(mcpServer: McpServer, ctx: ToolContext): void {
  const server = withCallLogging(mcpServer);
  registerAuthTools(server, ctx);
  registerCampaignTools(server, ctx);
  registerDiscoveryTools(server, ctx);
  registerSearchTools(server, ctx);
  registerEntityTools(server, ctx);
  registerPostsTool(server, ctx);
  registerRelationsTool(server, ctx);
  registerAttributesTool(server, ctx);
  registerEntityTagsTool(server, ctx);
  registerOrganisationMembersTool(server, ctx);
  registerEntityImageTool(server, ctx);
}
