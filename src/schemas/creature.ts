import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const CreatureInputSchema = BaseEntityInputSchema.extend({
  creature_id: z.number().int().positive().optional(),
  locations: z.array(z.number().int().positive()).optional(),
  status_id: z.number().int().positive().optional(),
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
