import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const TimelineInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
