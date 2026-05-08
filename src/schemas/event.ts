import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const EventInputSchema = BaseEntityInputSchema.extend({
  date: z.string().optional(),
  locations: z.array(z.number().int().positive()).optional(),
  calendar_id: z.number().int().positive().optional(),
  calendar_year: z.number().int().optional(),
  calendar_month: z.number().int().optional(),
  calendar_day: z.number().int().optional(),
});
