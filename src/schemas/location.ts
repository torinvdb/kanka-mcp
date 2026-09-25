import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const LocationInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  is_destroyed: z.boolean().optional(),
});
