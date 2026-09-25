import { z, ZodError } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { EntitySubResource } from "../client/client.js";
import { KankaError } from "../client/errors.js";
import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";
import { fieldsInput, responseInput, slimRecord } from "./slim.js";
import { applyEntryEdits } from "../services/entry-edits.js";

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
  /** Offer `entry_edits` on update: anchored edits applied server-side to the live record's entry. */
  entryEdits?: boolean;
}

const entryEditInputs = {
  entry_edits: z
    .array(z.object({ before: z.string().min(1), after: z.string() }))
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Update only: {before, after} pairs applied in order to the live entry. Each before must occur exactly once; the U+00A0 count must change by exactly nbsp_delta (default 0); otherwise EDIT_REFUSED and nothing is written. Do not also send data.entry.",
    ),
  nbsp_delta: z.number().int().optional(),
  expect_updated_at: z
    .string()
    .optional()
    .describe("With entry_edits: the updated_at of your own read. A different live value fails with CONFLICT."),
};

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
        ...(opts.entryEdits ? entryEditInputs : {}),
      },
    },
    async (args) =>
      safeRun(async () => {
        const { campaign_id, entity_id, action, id, data, confirm, page, response: mode, fields } = args;
        const { entry_edits, nbsp_delta, expect_updated_at } = args as {
          entry_edits?: { before: string; after: string }[];
          nbsp_delta?: number;
          expect_updated_at?: string;
        };
        if (entry_edits && action !== "update") {
          throw new KankaError("VALIDATION_ERROR", "`entry_edits` applies to action='update' only");
        }
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
            if (!data && !entry_edits) {
              throw new KankaError("VALIDATION_ERROR", "`data` is required for action='update'");
            }
            if (entry_edits && data && Object.prototype.hasOwnProperty.call(data, "entry")) {
              throw new KankaError("VALIDATION_ERROR", "Send either `entry` in `data` or `entry_edits`, not both");
            }
            const validated = validateOrThrow(partialOf(opts.schema), data ?? {});
            let editSummary: Record<string, unknown> | undefined;
            if (entry_edits) {
              const live = (await ctx.client.getSubResource(campaign_id, entity_id, opts.sub, id)).data as {
                entry?: string | null;
                name?: string;
                updated_at?: string;
              };
              if (expect_updated_at !== undefined && live.updated_at !== expect_updated_at) {
                throw new KankaError("CONFLICT", "The live record changed since your read; nothing was written", {
                  details: { expected: expect_updated_at, live: live.updated_at },
                });
              }
              const result = applyEntryEdits(live.entry ?? "", entry_edits, nbsp_delta ?? 0);
              editSummary = {
                applied: result.applied,
                changed: result.changed,
                nbsp: result.nbsp,
                length: result.length,
                live_updated_at: live.updated_at,
              };
              validated.entry = result.text;
              if (validated.name === undefined && live.name !== undefined) validated.name = live.name;
            }
            const response = await ctx.client.updateSubResource(
              campaign_id,
              entity_id,
              opts.sub,
              id,
              validated,
            );
            const slimByDefault = entry_edits ? slimRecord(response.data, opts.slimKeys, fields) : shape(response.data);
            return jsonResult({
              data: mode === "full" ? response.data : slimByDefault,
              ...(editSummary ? { entry_edits: editSummary } : {}),
            });
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
