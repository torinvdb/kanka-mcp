import { z, ZodError } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { EntitySubResource } from "../client/client.js";
import { KankaError } from "../client/errors.js";
import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";
import { fieldsInput, responseInput, slimRecord } from "./slim.js";

interface SubResourceToolOptions {
  name: string;
  title: string;
  description: string;
  sub: EntitySubResource;
  schema: z.ZodTypeAny;
  /** Keys kept when the caller passes `response: "slim"`. */
  slimKeys: readonly string[];
  /**
   * Fields a create must carry that follow from the request path, not from the
   * caller. Applied after validation, so caller data cannot override them.
   */
  createFromPath?: (entityId: number) => Record<string, unknown>;
}

export function registerSubResourceTool(
  server: McpServer,
  ctx: ToolContext,
  opts: SubResourceToolOptions,
): void {
  server.registerTool(
    opts.name,
    {
      title: opts.title,
      description: opts.description,
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_id: z
          .number()
          .int()
          .positive()
          .describe("The GLOBAL entity_id (not the type-scoped id)"),
        action: z.enum(["list", "get", "create", "update", "delete"]),
        id: z.number().int().positive().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        confirm: z.literal(true).optional(),
        page: z.number().int().positive().optional(),
        response: responseInput,
        fields: fieldsInput,
      },
    },
    async ({ campaign_id, entity_id, action, id, data, confirm, page, response: mode, fields }) =>
      safeRun(async () => {
        const shape = (record: unknown): unknown =>
          mode === "slim" ? slimRecord(record, opts.slimKeys, fields) : record;
        switch (action) {
          case "list": {
            const response = await ctx.client.listSubResource(
              campaign_id,
              entity_id,
              opts.sub,
              page ?? 1,
            );
            return jsonResult({
              data: response.data.map(shape),
              meta: response.meta,
              links: response.links,
            });
          }
          case "get": {
            if (id === undefined) {
              throw new KankaError("VALIDATION_ERROR", "`id` is required for action='get'");
            }
            const response = await ctx.client.getSubResource(
              campaign_id,
              entity_id,
              opts.sub,
              id,
            );
            return jsonResult({ data: shape(response.data) });
          }
          case "create": {
            if (!data) {
              throw new KankaError("VALIDATION_ERROR", "`data` is required for action='create'");
            }
            const validated = validateOrThrow(opts.schema, data);
            const response = await ctx.client.createSubResource(
              campaign_id,
              entity_id,
              opts.sub,
              { ...validated, ...(opts.createFromPath?.(entity_id) ?? {}) },
            );
            return jsonResult({ data: shape(response.data) });
          }
          case "update": {
            if (id === undefined) {
              throw new KankaError("VALIDATION_ERROR", "`id` is required for action='update'");
            }
            if (!data) {
              throw new KankaError("VALIDATION_ERROR", "`data` is required for action='update'");
            }
            const validated = validateOrThrow(partialOf(opts.schema), data);
            const response = await ctx.client.updateSubResource(
              campaign_id,
              entity_id,
              opts.sub,
              id,
              validated,
            );
            return jsonResult({ data: shape(response.data) });
          }
          case "delete": {
            if (id === undefined) {
              throw new KankaError("VALIDATION_ERROR", "`id` is required for action='delete'");
            }
            if (confirm !== true) {
              throw new KankaError(
                "VALIDATION_ERROR",
                "`confirm: true` is required for action='delete'",
              );
            }
            await ctx.client.deleteSubResource(campaign_id, entity_id, opts.sub, id);
            return jsonResult({ deleted: true, id });
          }
        }
      }),
  );
}

export function validateOrThrow(schema: z.ZodTypeAny, data: unknown): Record<string, unknown> {
  try {
    return schema.parse(data) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "_root";
        fields[key] ??= [];
        fields[key].push(issue.message);
      }
      throw new KankaError("VALIDATION_ERROR", "Client-side validation failed", {
        details: { fields },
      });
    }
    throw err;
  }
}

export function partialOf(schema: z.ZodTypeAny): z.ZodTypeAny {
  return typeof (schema as { partial?: unknown }).partial === "function"
    ? (schema as unknown as { partial: () => z.ZodTypeAny }).partial()
    : schema;
}
