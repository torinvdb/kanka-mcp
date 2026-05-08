import { z, ZodError } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { KankaError } from "../client/errors.js";
import {
  ENTITY_TYPES,
  getCreateSchema,
  getUpdateSchema,
  type EntityType,
} from "../schemas/index.js";
import { isEntityType } from "../schemas/entity-types.js";
import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";

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
        "Browse a campaign's entities. Use this to enumerate, page through, or filter by type / name / tags. For looking up a specific entity by id, prefer kanka_get_entity. For text-content search, use kanka_full_text_search.\n\nIncremental sync: pass `since` (ISO 8601, e.g. the previous response's `sync` value) to receive only entities modified after that time. The response includes a `sync` token to use on the next call.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: z.enum(ENTITY_TYPES).optional(),
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
      },
    },
    async ({ campaign_id, entity_type, page, per_page, filters, since }) =>
      safeRun(async () => {
        const response = await ctx.client.listEntitiesPage({
          campaignId: campaign_id,
          type: entity_type,
          page,
          perPage: per_page,
          filters,
          lastSync: since,
        });

        for (const item of response.data) {
          if (typeof item.entity_id === "number" && typeof item.id === "number") {
            const t = (entity_type ?? (item.type as string | undefined)) as string | undefined;
            if (t && isEntityType(t)) {
              ctx.idResolver.remember({
                campaignId: campaign_id,
                entityId: item.entity_id,
                type: t,
                typeId: item.id,
                name: item.name,
              });
            }
          }
        }

        return jsonResult({
          data: response.data,
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
        "Fetch a single entity by either its type-scoped id (requires entity_type) OR its global entity_id. The dual-ID system is resolved transparently: if you only know entity_id, the resolver will discover the type and fetch the typed record.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: z.enum(ENTITY_TYPES).optional(),
        id: z.number().int().positive().optional(),
        entity_id: z.number().int().positive().optional(),
      },
    },
    async ({ campaign_id, entity_type, id, entity_id }) =>
      safeRun(async () => {
        let resolvedType: EntityType | undefined = entity_type;
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
        return jsonResult({ type: resolvedType, data: response.data });
      }),
  );

  server.registerTool(
    "kanka_create_entity",
    {
      title: "Create entity",
      description:
        "Create a new entity. Call kanka_describe_entity_type first to discover the per-type schema for `data`. Returns the created record including its type-scoped `id` and global `entity_id`.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: z.enum(ENTITY_TYPES),
        data: z.record(z.string(), z.unknown()),
      },
    },
    async ({ campaign_id, entity_type, data }) =>
      safeRun(async () => {
        const schema = getCreateSchema(entity_type);
        const validated = validateOrThrow(schema, data);
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
        return jsonResult({ type: entity_type, data: response.data });
      }),
  );

  server.registerTool(
    "kanka_update_entity",
    {
      title: "Update entity",
      description:
        "Partial update (PATCH) on an existing entity. Provide only the fields you want to change. The `id` is the type-scoped id (e.g. character id), not entity_id.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_type: z.enum(ENTITY_TYPES),
        id: z.number().int().positive(),
        data: z.record(z.string(), z.unknown()),
      },
    },
    async ({ campaign_id, entity_type, id, data }) =>
      safeRun(async () => {
        const schema = getUpdateSchema(entity_type);
        const validated = validateOrThrow(schema, data);
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
        return jsonResult({ type: entity_type, data: response.data });
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
        entity_type: z.enum(ENTITY_TYPES),
        id: z.number().int().positive(),
        confirm: z.literal(true),
        entity_id: z.number().int().positive().optional(),
      },
    },
    async ({ campaign_id, entity_type, id, entity_id }) =>
      safeRun(async () => {
        await ctx.client.deleteEntity(campaign_id, entity_type, id);
        if (entity_id) ctx.idResolver.forget(campaign_id, entity_id);
        return jsonResult({ deleted: true, type: entity_type, id, entity_id });
      }),
  );
}
