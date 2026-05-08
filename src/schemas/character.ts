import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const CharacterInputSchema = BaseEntityInputSchema.extend({
  title: z.string().max(191).optional(),
  age: z.string().max(191).optional(),
  sex: z.string().max(191).optional(),
  pronouns: z.string().max(191).optional(),
  location_id: z.number().int().positive().optional(),
  race_id: z.number().int().positive().optional(),
  family_id: z.number().int().positive().optional(),
  is_dead: z.boolean().optional(),
  is_personality_visible: z.boolean().optional(),
  families: z.array(z.number().int().positive()).optional(),
  races: z.array(z.number().int().positive()).optional(),
});
