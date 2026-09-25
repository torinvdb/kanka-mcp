import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const FamilyInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  family_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  locations: z.array(z.number().int().positive()).optional(),
  status_id: z.number().int().positive().optional(),
});
