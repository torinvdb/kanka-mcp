import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const ObjectInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  item_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  creators: z.array(z.number().int().positive()).optional(),
  price: z.string().optional(),
  size: z.string().optional(),
  weight: z.string().optional(),
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
