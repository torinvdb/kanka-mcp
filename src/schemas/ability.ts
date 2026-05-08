import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const AbilityInputSchema = BaseEntityInputSchema.extend({
  ability_id: z.number().int().positive().optional(),
  charges: z.string().optional(),
  is_attributes_private: z.boolean().optional(),
});
