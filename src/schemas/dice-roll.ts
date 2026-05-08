import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const DiceRollInputSchema = BaseEntityInputSchema.extend({
  parameters: z.string().min(1).describe("Dice roll configuration, e.g. '1d20+3'"),
  system: z.string().optional(),
  character_id: z.number().int().positive().optional(),
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
