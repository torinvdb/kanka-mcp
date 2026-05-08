import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { KankaError } from "../client/errors.js";
import { logger } from "../logger.js";

export type { CallToolResult };

export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(error: unknown): CallToolResult {
  if (error instanceof KankaError) {
    const payload = {
      error: {
        code: error.code,
        message: error.message,
        status: error.status,
        details: error.details,
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ err: error }, "Unhandled tool error");
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { code: "INTERNAL", message } }, null, 2) }],
    isError: true,
  };
}

export async function safeRun(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err);
  }
}
