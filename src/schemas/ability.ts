import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const AbilityInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  ability_id: z.number().int().positive().optional(),
  charges: z.string().optional(),
  is_attributes_private: z.boolean().optional(),
});
