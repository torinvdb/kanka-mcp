import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { EntityImageSlot } from "../client/client.js";
import { KankaError } from "../client/errors.js";
import { loadUploadSettings, readUploadFile } from "../services/upload-policy.js";
import type { ToolContext } from "./context.js";
import { jsonResult, safeRun } from "./result.js";

// https://app.kanka.io/api-docs/1.0/entities/entity-image

function slotIsSet(slot: EntityImageSlot | null): boolean {
  return Boolean(slot && (slot.uuid || slot.full || slot.thumbnail));
}

export function registerEntityImageTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "kanka_entity_image",
    {
      title: "Entity image",
      annotations: { destructiveHint: true },
      description:
        "Read, upload, or remove an entity's image (or its header image with `is_header: true`). Takes the GLOBAL `entity_id`. Actions: get; upload (file_path: absolute path to a local .png/.jpg/.jpeg/.gif/.webp inside a directory the operator allowlisted; replace?: true to overwrite an image that is already set, otherwise the call refuses and reports the existing image URL); remove (confirm: true). Upload refusals come back as UPLOAD_REFUSED with the reason.",
      inputSchema: {
        campaign_id: z.number().int().positive(),
        entity_id: z
          .number()
          .int()
          .positive()
          .describe("The entity's GLOBAL entity_id, not the type-scoped id"),
        action: z.enum(["get", "upload", "remove"]),
        file_path: z
          .string()
          .min(1)
          .max(4096)
          .optional()
          .describe("upload only: absolute path to the image file, inside an allowlisted upload root"),
        is_header: z
          .boolean()
          .optional()
          .describe("Target the header image instead of the main image"),
        replace: z
          .boolean()
          .optional()
          .describe("upload only: overwrite an image that is already set (default false)"),
        confirm: z.literal(true).optional().describe("Required for action='remove'"),
      },
    },
    async ({ campaign_id, entity_id, action, file_path, is_header, replace, confirm }) =>
      safeRun(async () => {
        const slot = is_header === true ? "header" : "image";

        switch (action) {
          case "get": {
            const current = await ctx.client.getEntityImage(campaign_id, entity_id);
            return jsonResult({ entity_id, image: current.image, header: current.header });
          }
          case "upload": {
            if (!file_path) {
              throw new KankaError("VALIDATION_ERROR", "`file_path` is required for action='upload'");
            }
            // Local checks first, so a refused path never costs an API call.
            const settings = (ctx.uploadSettings ?? (() => loadUploadSettings()))();
            const file = await readUploadFile(file_path, settings);

            const current = await ctx.client.getEntityImage(campaign_id, entity_id);
            const existing = current[slot];
            // Fail closed: an unrecognised response cannot prove the slot is empty.
            if (existing === undefined && replace !== true) {
              throw new KankaError(
                "UPLOAD_REFUSED",
                `The current ${slot} state of entity ${entity_id} could not be read from Kanka, so an existing image cannot be ruled out. Pass replace: true to upload anyway.`,
              );
            }
            const hadImage = slotIsSet(existing ?? null);
            const previous = existing?.full ?? existing?.thumbnail ?? null;
            if (hadImage && replace !== true) {
              const shown = previous ?? `gallery uuid ${String(existing?.uuid)}`;
              throw new KankaError(
                "UPLOAD_REFUSED",
                `Entity ${entity_id} already has ${slot === "header" ? "a header image" : "an image"}: ${shown}. Pass replace: true to overwrite it.`,
                { details: { existing_image: previous, existing_uuid: existing?.uuid ?? null } },
              );
            }

            const result = await ctx.client.uploadEntityImage(
              campaign_id,
              entity_id,
              { bytes: file.bytes, filename: file.filename, mimeType: file.mimeType },
              is_header,
            );
            return jsonResult({
              entity_id,
              slot,
              replaced: hadImage,
              ...(existing === undefined ? { previous_state: "unknown" } : {}),
              ...(hadImage ? { previous_image: previous } : {}),
              file: { name: file.filename, type: file.mimeType, bytes: file.size },
              image: result.image,
              header: result.header,
            });
          }
          case "remove": {
            if (confirm !== true) {
              throw new KankaError(
                "VALIDATION_ERROR",
                "`confirm: true` is required for action='remove'",
              );
            }
            await ctx.client.deleteEntityImage(campaign_id, entity_id, is_header);
            return jsonResult({ removed: true, entity_id, slot });
          }
        }
      }),
  );
}
