import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const FamilyInputSchema = BaseEntityInputSchema.extend({
  family_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  status_id: z.number().int().positive().optional(),
});
