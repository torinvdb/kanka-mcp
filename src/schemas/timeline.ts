import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const TimelineInputSchema = BaseEntityInputSchema.extend({
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
