import { z, ZodError } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { KankaError } from "../client/errors.js";
import {
  ENTITY_TYPE_INPUTS,
  getCreateSchema,
  getUpdateSchema,
  normalizeEntityType,
  unknownKeys,
  type EntityType,
  type EntityTypeInput,
} from "../schemas/index.js";
import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";
import { fieldsInput, responseInput, slimEntity, type ResponseMode } from "./slim.js";
import { applyEntryEdits } from "../services/entry-edits.js";

const entityTypeInput = z
  .enum(ENTITY_TYPE_INPUTS)
  .describe("Kanka module code. `item` and its older alias `object` both address /items.");

function canonicalType(input: EntityTypeInput): EntityType {
  const t = normalizeEntityType(input);
  if (!t) throw new KankaError("VALIDATION_ERROR", `Unknown entity_type: ${String(input)}`);
  return t;
}

function shape(record: unknown, type: EntityType | undefined, mode: ResponseMode | undefined, fields?: string[]): unknown {
  return mode === "slim" ? slimEntity(record, type, fields) : record;
}

const ENTRY_EDITS_DOC =
  "\n\nEntry edits: instead of sending the whole `entry` in `data`, pass `entry_edits`, a list of `{before, after}` pairs. The server reads the live record, applies the edits in order, and PATCHes the result with the rest of `data`. Each `before` must occur exactly once in the text as it stands when that edit runs, and the U+00A0 count must change by exactly `nbsp_delta` (default 0); otherwise the call fails with EDIT_REFUSED and nothing is written. Pass `expect_updated_at` (the `updated_at` of your own read) to fail with CONFLICT if the page changed since. `dry_run: true` runs every check and writes nothing. Anchors and replacements are literal text. The response defaults to slim and never echoes the entry. Do not put `entry` in `data` together with `entry_edits`.";

const entryEditsInput = z
  .array(z.object({ before: z.string().min(1), after: z.string() }))
  .min(1)
  .max(200)
  .optional()
  .describe("Anchored edits applied server-side to the live entry. See the tool description.");

const SLIM_DOC =
  "\n\nResponse size: pass `response: \"slim\"` to get back only id, entity_id, name, type, is_private, updated_at and (for tree types) parent_id, without `entry`, `entry_parsed` or image URLs. Add `fields` to copy extra keys, e.g. `fields: [\"entry\"]`. The default `full` returns the whole record.";

function validateOrThrow(schema: z.ZodTypeAny, data: unknown): Record<string, unknown> {
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

export function registerEntityTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "kanka_list_entities",
    {
      title: "List entities",
      description:
        "Browse a campaign's entities. Use this to enumerate, page through, or filter by type / name / tags. For looking up a specific entity by id, prefer kanka_get_entity. For text-content search, use kanka_full_text_search.\n\nIncremental sync: pass `since` (ISO 8601, e.g. the previous response's `sync` value) to receive only entities modified after that time. The response includes a `sync` token to use on the next call." +
        SLIM_DOC,
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: entityTypeInput.optional(),
        page: z.number().int().positive().optional(),
        per_page: z.number().int().positive().max(100).optional(),
        filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        since: z
          .string()
          .datetime({ offset: true })
          .optional()
          .describe(
            "ISO 8601 timestamp (e.g. 2026-05-08T18:00:00Z). Returns only entities updated after this time. Use the `sync` token from a previous response to walk the delta.",
          ),
        response: responseInput,
        fields: fieldsInput,
      },
    },
    async ({ campaign_id, entity_type, page, per_page, filters, since, response: mode, fields }) =>
      safeRun(async () => {
        const type = entity_type ? canonicalType(entity_type) : undefined;
        const response = await ctx.client.listEntitiesPage({
          campaignId: campaign_id,
          type,
          page,
          perPage: per_page,
          filters,
          lastSync: since,
        });

        for (const item of response.data) {
          rememberRow(ctx, campaign_id, item, type);
        }

        return jsonResult({
          data: response.data.map((row) => shape(row, type, mode, fields)),
          meta: response.meta,
          links: response.links,
          sync: response.sync,
        });
      }),
  );

  server.registerTool(
    "kanka_get_entity",
    {
      title: "Get entity",
      description:
        "Fetch a single entity by either its type-scoped id (requires entity_type) OR its global entity_id. The dual-ID system is resolved transparently: if you only know entity_id, the resolver will discover the type and fetch the typed record." +
        SLIM_DOC,
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: entityTypeInput.optional(),
        id: z.number().int().positive().optional(),
        entity_id: z.number().int().positive().optional(),
        response: responseInput,
        fields: fieldsInput,
      },
    },
    async ({ campaign_id, entity_type, id, entity_id, response: mode, fields }) =>
      safeRun(async () => {
        let resolvedType: EntityType | undefined = entity_type
          ? canonicalType(entity_type)
          : undefined;
        let typeId: number | undefined = id;

        if (typeId === undefined) {
          if (entity_id === undefined) {
            throw new KankaError(
              "VALIDATION_ERROR",
              "Provide either {entity_type, id} or entity_id",
            );
          }
          const resolved = await ctx.idResolver.resolveByEntityId(campaign_id, entity_id);
          resolvedType = resolved.type;
          typeId = resolved.typeId;
        }

        if (!resolvedType) {
          throw new KankaError(
            "VALIDATION_ERROR",
            "entity_type is required when fetching by id",
          );
        }

        const response = await ctx.client.getTypedEntity(campaign_id, resolvedType, typeId);
        return jsonResult({
          type: resolvedType,
          data: shape(response.data, resolvedType, mode, fields),
        });
      }),
  );

  server.registerTool(
    "kanka_create_entity",
    {
      title: "Create entity",
      description:
        "Create a new entity. Call kanka_describe_entity_type first to discover the per-type schema for `data`. Returns the created record including its type-scoped `id` and global `entity_id`. Keys the schema does not declare are not sent and come back in `ignored_fields`." +
        SLIM_DOC,
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: entityTypeInput,
        data: z.record(z.string(), z.unknown()),
        response: responseInput,
        fields: fieldsInput,
      },
    },
    async ({ campaign_id, entity_type: entityTypeArg, data, response: mode, fields }) =>
      safeRun(async () => {
        const entity_type = canonicalType(entityTypeArg);
        const schema = getCreateSchema(entity_type);
        const validated = validateOrThrow(schema, data);
        const ignored = unknownKeys(schema, data);
        const response = await ctx.client.createEntity(campaign_id, entity_type, validated);
        const created = response.data as { id?: number; entity_id?: number; name?: string };
        if (typeof created.id === "number" && typeof created.entity_id === "number") {
          ctx.idResolver.remember({
            campaignId: campaign_id,
            entityId: created.entity_id,
            type: entity_type,
            typeId: created.id,
            name: created.name,
          });
        }
        return jsonResult({
          type: entity_type,
          data: shape(response.data, entity_type, mode, fields),
          ...(ignored.length > 0 ? { ignored_fields: ignored } : {}),
        });
      }),
  );

  server.registerTool(
    "kanka_update_entity",
    {
      title: "Update entity",
      description:
        "Partial update (PATCH) on an existing entity. Provide only the fields you want to change. The `id` is the type-scoped id (e.g. character id), not entity_id. To clear a parent or status send null: `{\"parent_id\": null}` or `{\"status_id\": null}`. Keys the type's schema does not declare are not sent; the response lists them in `ignored_fields` (see kanka_describe_entity_type)." +
        ENTRY_EDITS_DOC +
        SLIM_DOC,
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: entityTypeInput,
        id: z.number().int().positive(),
        data: z.record(z.string(), z.unknown()),
        entry_edits: entryEditsInput,
        nbsp_delta: z.number().int().optional().describe("Allowed change in the U+00A0 count under entry_edits. Default 0."),
        expect_updated_at: z
          .string()
          .optional()
          .describe("Under entry_edits: the updated_at of your own read. A different live value fails with CONFLICT."),
        dry_run: z.boolean().optional().describe("Under entry_edits: run every check against the live entry, write nothing."),
        response: responseInput,
        fields: fieldsInput,
      },
    },
    async ({
      campaign_id,
      entity_type: entityTypeArg,
      id,
      data,
      entry_edits,
      nbsp_delta,
      expect_updated_at,
      dry_run,
      response: mode,
      fields,
    }) =>
      safeRun(async () => {
        const entity_type = canonicalType(entityTypeArg);
        const schema = getUpdateSchema(entity_type);
        if (entry_edits && Object.prototype.hasOwnProperty.call(data, "entry")) {
          throw new KankaError("VALIDATION_ERROR", "Send either `entry` in `data` or `entry_edits`, not both");
        }
        const validated = validateOrThrow(schema, data);
        const ignored = unknownKeys(schema, data);
        let editSummary: Record<string, unknown> | undefined;
        if (entry_edits) {
          const live = (await ctx.client.getTypedEntity(campaign_id, entity_type, id)).data as {
            entry?: string | null;
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
          const slimLive = shape(live, entity_type, "slim", fields);
          if (dry_run) {
            return jsonResult({ type: entity_type, dry_run: true, entry_edits: editSummary, data: slimLive });
          }
          if (!result.changed && Object.keys(validated).length === 0) {
            return jsonResult({ type: entity_type, unchanged: true, entry_edits: editSummary, data: slimLive });
          }
          validated.entry = result.text;
        }
        const response = await ctx.client.updateEntity(campaign_id, entity_type, id, validated);
        const updated = response.data as { id?: number; entity_id?: number; name?: string };
        if (typeof updated.entity_id === "number") {
          ctx.idResolver.remember({
            campaignId: campaign_id,
            entityId: updated.entity_id,
            type: entity_type,
            typeId: updated.id ?? id,
            name: updated.name,
          });
        }
        return jsonResult({
          type: entity_type,
          data: shape(response.data, entity_type, entry_edits ? (mode ?? "slim") : mode, fields),
          ...(editSummary ? { entry_edits: editSummary } : {}),
          ...(ignored.length > 0 ? { ignored_fields: ignored } : {}),
        });
      }),
  );

  server.registerTool(
    "kanka_delete_entity",
    {
      title: "Delete entity",
      description:
        "Permanently delete an entity. Requires `confirm: true` to execute. Note: kanka_get_entity by entity_id may continue to succeed briefly via cache; pass an unknown entity_id to bust the resolver if needed.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: entityTypeInput,
        id: z.number().int().positive(),
        confirm: z.literal(true),
        entity_id: z.number().int().positive().optional(),
      },
    },
    async ({ campaign_id, entity_type: entityTypeArg, id, entity_id }) =>
      safeRun(async () => {
        const entity_type = canonicalType(entityTypeArg);
        await ctx.client.deleteEntity(campaign_id, entity_type, id);
        if (entity_id) ctx.idResolver.forget(campaign_id, entity_id);
        return jsonResult({ deleted: true, type: entity_type, id, entity_id });
      }),
  );
}

/**
 * Cache the entity_id -> typed record mapping for a list row. Typed list rows carry
 * `id` (type-scoped) and `entity_id`; untyped /entities rows carry `id` (entity id),
 * `entity_type` and `child_id` (type-scoped).
 */
function rememberRow(
  ctx: ToolContext,
  campaignId: number,
  row: Record<string, unknown>,
  knownType: EntityType | undefined,
): void {
  const name = typeof row.name === "string" ? row.name : undefined;
  if (knownType) {
    if (typeof row.entity_id === "number" && typeof row.id === "number") {
      ctx.idResolver.remember({ campaignId, entityId: row.entity_id, type: knownType, typeId: row.id, name });
    }
    return;
  }
  const type = normalizeEntityType(row.entity_type);
  const entityId = typeof row.entity_id === "number" ? row.entity_id : row.id;
  if (type && typeof row.child_id === "number" && typeof entityId === "number") {
    ctx.idResolver.remember({ campaignId, entityId, type, typeId: row.child_id, name });
  }
}
