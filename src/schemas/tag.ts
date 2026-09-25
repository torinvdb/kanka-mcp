import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const TagInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  tag_id: z.number().int().positive().optional(),
  colour: z
    .string()
    .regex(/^#?[0-9a-fA-F]{3,8}$/, "Expected a hex colour like #ff0000")
    .optional(),
  is_auto_applied: z.boolean().optional(),
  is_hidden: z.boolean().optional(),
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
