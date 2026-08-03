import { z } from 'zod';

const dayOfWeekEnum = z.enum([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday',
]);

// Schedule schema with day_of_week, time, and until defaulting to null.
// Redash's scheduler indexes these keys directly, so they must always
// be present in the stored JSON (even as null).
// interval is in seconds (e.g., 86400 = daily, 604800 = weekly)
export const scheduleSchema = z.object({
  interval: z.number(),
  time: z.string().nullable().default(null),
  until: z.string().nullable().default(null),
  day_of_week: dayOfWeekEnum.nullable().default(null),
  disabled: z.boolean().optional(),
}).optional().nullable();
