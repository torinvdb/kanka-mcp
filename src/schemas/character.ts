import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const CharacterInputSchema = BaseEntityInputSchema.extend({
  title: z.string().max(191).optional(),
  age: z.string().max(191).optional(),
  sex: z.string().max(191).optional(),
  pronouns: z.string().max(191).optional(),
  location_id: z.number().int().positive().optional(),
  race_id: z.number().int().positive().optional(),
  family_id: z.number().int().positive().optional(),
  // Older Kanka flag; current campaigns mark death through a category status (`status_id`).
  is_dead: z.boolean().optional(),
  status_id: z.number().int().positive().optional(),
  is_personality_visible: z.boolean().optional(),
  is_personality_pinned: z.boolean().optional(),
  is_appearance_pinned: z.boolean().optional(),
  families: z.array(z.number().int().positive()).optional(),
  races: z.array(z.number().int().positive()).optional(),
  locations: z.array(z.number().int().positive()).optional(),
  // Trait rows are parallel arrays: personality_name[i] pairs with personality_entry[i].
  personality_name: z.array(z.string()).optional(),
  personality_entry: z.array(z.string()).optional(),
  appearance_name: z.array(z.string()).optional(),
  appearance_entry: z.array(z.string()).optional(),
  entity_image_uuid: z.string().uuid().optional(),
  entity_header_uuid: z.string().uuid().optional(),
});
