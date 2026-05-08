import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const QuestInputSchema = BaseEntityInputSchema.extend({
  quest_id: z.number().int().positive().optional(),
  instigator_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  status_id: z.number().int().positive().optional(),
});
