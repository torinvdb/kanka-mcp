import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const LocationInputSchema = BaseEntityInputSchema.extend({
  location_id: z.number().int().positive().optional(),
  is_destroyed: z.boolean().optional(),
});
