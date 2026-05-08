import { z } from "zod";

import { BaseEntityInputSchema } from "./common.js";

export const CalendarInputSchema = BaseEntityInputSchema.extend({
  weekday: z.array(z.string()).min(2),
  current_year: z.number().int().optional(),
  current_month: z.number().int().optional(),
  current_day: z.number().int().optional(),
  month_name: z.array(z.string()).optional(),
  month_length: z.array(z.number().int().positive()).optional(),
  month_type: z.array(z.enum(["standard", "intercalary"])).optional(),
  year_name: z.array(z.string()).optional(),
  year_number: z.array(z.number().int()).optional(),
  moon_name: z.array(z.string()).optional(),
  moon_fullmoon: z.array(z.number().int()).optional(),
  moon_offset: z.array(z.number().int()).optional(),
  moon_colour: z.array(z.string()).optional(),
  moon_id: z.array(z.number().int()).optional(),
  epoch_name: z.array(z.string()).optional(),
  season_name: z.array(z.string()).optional(),
  season_month: z.array(z.number().int()).optional(),
  season_day: z.array(z.number().int()).optional(),
  format: z.string().optional(),
  has_leap_year: z.boolean().optional(),
  leap_year_amount: z.number().int().optional(),
  leap_year_offset: z.number().int().optional(),
  leap_year_start: z.number().int().optional(),
  skip_year_zero: z.boolean().optional(),
});
