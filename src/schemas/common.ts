import { z } from "zod";

export const BaseEntityInputSchema = z.object({
  name: z.string().min(1).max(191),
  entry: z.string().optional(),
  type: z.string().max(45).optional(),
  tags: z.array(z.number().int().positive()).optional(),
  is_private: z.boolean().optional(),
  is_template: z.boolean().optional(),
  image_uuid: z.string().uuid().optional(),
  header_uuid: z.string().uuid().optional(),
  tooltip: z.string().optional(),
});

export type BaseEntityInput = z.infer<typeof BaseEntityInputSchema>;
