import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { KankaError } from "../client/errors.js";
import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";
import { partialOf, validateOrThrow } from "./subresource.js";

// https://app.kanka.io/api-docs/1.0/organisation-members
const OrganisationMemberInputSchema = z.object({
  character_id: z.number().int().positive().describe("Type-scoped character id (not entity_id)"),
  organisation_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Type-scoped organisation id. Filled from the path on create; on update it re-points the membership."),
  role: z.string().max(191).nullable().optional(),
  is_private: z.boolean().optional(),
  pin_id: z
    .number()
    .int()
    .min(0)
    .max(3)
    .nullable()
    .optional()
    .describe("0 unpinned, 1 pinned to the character, 2 pinned to the organisation, 3 both"),
  status_id: z
    .number()
    .int()
    .min(0)
    .max(2)
    .optional()
    .describe("0 active, 1 past, 2 unknown"),
  parent_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Id of another membership in the same organisation that this member reports to"),
});

export function registerOrganisationMembersTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "kanka_organisation_members",
    {
      title: "Organisation members",
      description:
        "List, read, add, update, or remove the members of an organisation. Identify the organisation by its type-scoped `organisation_id` or by its global `entity_id` (resolved to the organisation). `id` is the membership id from list, not the character id. Actions: list (page), get (id), create (data: {character_id, role?, status_id?, pin_id?, is_private?, parent_id?}), update (id, data), delete (id, confirm: true). To move a member to another organisation, create the membership in the target and then delete it from the source; `update` with `data.organisation_id` asks Kanka to re-point it in place.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        organisation_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Type-scoped organisation id (the `id` from kanka_get_entity on an organisation)"),
        entity_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The organisation's GLOBAL entity_id; used when organisation_id is not given"),
        action: z.enum(["list", "get", "create", "update", "delete"]),
        id: z.number().int().positive().optional().describe("Membership id"),
        data: z.record(z.string(), z.unknown()).optional(),
        confirm: z.literal(true).optional(),
        page: z.number().int().positive().optional(),
      },
    },
    async ({ campaign_id, organisation_id, entity_id, action, id, data, confirm, page }) =>
      safeRun(async () => {
        const orgId = await resolveOrganisationId(ctx, campaign_id, organisation_id, entity_id);
        const requireId = (): number => {
          if (id === undefined) {
            throw new KankaError("VALIDATION_ERROR", `\`id\` is required for action='${action}'`);
          }
          return id;
        };
        const requireData = (): Record<string, unknown> => {
          if (!data) {
            throw new KankaError("VALIDATION_ERROR", `\`data\` is required for action='${action}'`);
          }
          return data;
        };

        switch (action) {
          case "list": {
            const response = await ctx.client.listOrganisationMembers(campaign_id, orgId, page ?? 1);
            return jsonResult({ data: response.data, meta: response.meta, links: response.links });
          }
          case "get": {
            const response = await ctx.client.getOrganisationMember(campaign_id, orgId, requireId());
            return jsonResult({ data: response.data });
          }
          case "create": {
            const validated = validateOrThrow(OrganisationMemberInputSchema, requireData());
            const response = await ctx.client.createOrganisationMember(campaign_id, orgId, {
              ...validated,
              // The path decides which organisation the member joins.
              organisation_id: orgId,
            });
            return jsonResult({ data: response.data });
          }
          case "update": {
            const memberId = requireId();
            const validated = validateOrThrow(partialOf(OrganisationMemberInputSchema), requireData());
            const response = await ctx.client.updateOrganisationMember(
              campaign_id,
              orgId,
              memberId,
              validated,
            );
            return jsonResult({ data: response.data });
          }
          case "delete": {
            const memberId = requireId();
            if (confirm !== true) {
              throw new KankaError(
                "VALIDATION_ERROR",
                "`confirm: true` is required for action='delete'",
              );
            }
            await ctx.client.deleteOrganisationMember(campaign_id, orgId, memberId);
            return jsonResult({ deleted: true, id: memberId });
          }
        }
      }),
  );
}

async function resolveOrganisationId(
  ctx: ToolContext,
  campaignId: number,
  organisationId: number | undefined,
  entityId: number | undefined,
): Promise<number> {
  if (organisationId !== undefined) return organisationId;
  if (entityId === undefined) {
    throw new KankaError("VALIDATION_ERROR", "Provide organisation_id or the organisation's entity_id");
  }
  const resolved = await ctx.idResolver.resolveByEntityId(campaignId, entityId);
  if (resolved.type !== "organisation") {
    throw new KankaError(
      "VALIDATION_ERROR",
      `entity_id ${entityId} is a ${resolved.type}, not an organisation`,
    );
  }
  return resolved.typeId;
}
