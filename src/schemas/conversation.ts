import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const ConversationInputSchema = BaseEntityInputSchema.extend({
  target_id: z
    .union([z.literal(1), z.literal(2)])
    .describe("Conversation target type: 1 = users, 2 = characters"),
  is_closed: z.boolean().optional(),
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
