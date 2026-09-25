import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const JournalInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  journal_id: z.number().int().positive().optional(),
  author_id: z.number().int().positive().optional(),
  date: z.string().optional(),
  calendar_id: z.number().int().positive().optional(),
  calendar_year: z.number().int().optional(),
  calendar_month: z.number().int().optional(),
  calendar_day: z.number().int().optional(),
  calendar_event_length: z.number().int().optional(),
});
