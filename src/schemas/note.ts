import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const NoteInputSchema = BaseEntityInputSchema.extend({
  note_id: z.number().int().positive().optional(),
  is_pinned: z.boolean().optional(),
});
