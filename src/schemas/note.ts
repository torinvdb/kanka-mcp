import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const NoteInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  note_id: z.number().int().positive().optional(),
  is_pinned: z.boolean().optional(),
});
