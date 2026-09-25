import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { logger } from "../logger.js";
import type { CallToolResult } from "./result.js";

// Identifiers only. Payloads (`data`, entry HTML, queries) and credentials are never logged.
const NUMERIC_KEYS = ["campaign_id", "id", "entity_id", "organisation_id"] as const;
const LABEL_KEYS = ["entity_type", "action", "response"] as const;

type Callback = (args: unknown, extra: unknown) => CallToolResult | Promise<CallToolResult>;

export function toolCallFields(args: unknown): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (typeof args !== "object" || args === null) return out;
  const a = args as Record<string, unknown>;
  for (const key of NUMERIC_KEYS) {
    const v = a[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  for (const key of LABEL_KEYS) {
    const v = a[key];
    if (typeof v === "string" && /^[a-z_]{1,32}$/.test(v)) out[key] = v;
  }
  return out;
}

function errorCode(result: CallToolResult | undefined): string | undefined {
  const first = result?.content?.[0];
  if (!first || first.type !== "text") return undefined;
  try {
    const code = (JSON.parse(first.text) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function wrap(name: string, cb: Callback): Callback {
  return async (args, extra) => {
    const started = performance.now();
    let result: CallToolResult | undefined;
    try {
      result = await cb(args, extra);
      return result;
    } finally {
      const failed = result === undefined || result.isError === true;
      logger.info(
        {
          tool: name,
          ...toolCallFields(args),
          outcome: failed ? "error" : "ok",
          error_code: failed ? (errorCode(result) ?? "THROWN") : undefined,
          duration_ms: Math.round(performance.now() - started),
        },
        "tool call",
      );
    }
  };
}

/**
 * A view of `server` whose registerTool wraps each handler with one structured
 * stderr log line per call. Calls the SDK rejects during input validation never
 * reach a handler, so they are not logged here.
 */
export function withCallLogging(server: McpServer): McpServer {
  const registerTool = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== "registerTool") return Reflect.get(target, prop, receiver);
      return (name: string, config: unknown, cb: Callback) =>
        registerTool(name, config, wrap(name, cb));
    },
  });
}
