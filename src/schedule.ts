import { z } from 'zod';

// Schedule schema with day_of_week defaulting to null
// day_of_week uses full English names: "Monday", "Tuesday", etc.
// interval is in seconds (e.g., 86400 = daily, 604800 = weekly)
export const scheduleSchema = z.object({
  interval: z.number(),
  time: z.string().nullable().optional(),
  until: z.string().nullable().optional(),
  day_of_week: z.string().nullable().default(null),
  disabled: z.boolean().optional(),
}).optional().nullable();
