import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const MapInputSchema = BaseEntityInputSchema.extend({
  // Parent in the same tree. Kanka reads `parent_id`; the older `<type>_id` field is ignored.
  parent_id: z.number().int().positive().optional(),
  map_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  center_marker_id: z.number().int().positive().optional(),
  center_x: z.number().optional(),
  center_y: z.number().optional(),
  is_real: z.boolean().optional(),
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
