#!/usr/bin/env node
// Transparently load .env from the working directory if present (Node 20.12+).
// MCP clients that launch us via absolute path won't have a useful CWD; this is
// purely a convenience for local dev (running from the repo root).
try {
  (process as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* .env missing or unreadable — ignore */
}

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { logger } from "./logger.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const { server } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("kanka-mcp ready on stdio");
}

main().catch((err) => {
  logger.fatal({ err }, "kanka-mcp crashed");
  process.exit(1);
});
