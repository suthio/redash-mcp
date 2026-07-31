import { z } from 'zod';

// Reproduce the schedule schema defined in index.ts
const scheduleSchema = z.object({
  interval: z.number().nullable(),
  time: z.string().nullable().optional(),
  until: z.string().nullable().optional(),
  day_of_week: z.string().nullable().default(null),
  disabled: z.boolean().optional(),
}).optional().nullable();

describe('scheduleSchema', () => {
  it('should default day_of_week to null when omitted', () => {
    const result = scheduleSchema.parse({
      interval: 86400,
      time: '01:15',
      until: '2026-08-14',
    });
    expect(result).toEqual({
      interval: 86400,
      time: '01:15',
      until: '2026-08-14',
      day_of_week: null,
    });
  });

  it('should preserve day_of_week when explicitly provided', () => {
    const result = scheduleSchema.parse({
      interval: 604800,
      time: '06:00',
      day_of_week: 'Monday',
    });
    expect(result).toMatchObject({
      interval: 604800,
      day_of_week: 'Monday',
    });
  });

  it('should preserve day_of_week as null when explicitly set to null', () => {
    const result = scheduleSchema.parse({
      interval: 86400,
      day_of_week: null,
    });
    expect(result).toMatchObject({
      interval: 86400,
      day_of_week: null,
    });
  });

  it('should return null for null input', () => {
    const result = scheduleSchema.parse(null);
    expect(result).toBeNull();
  });

  it('should return undefined for undefined input', () => {
    const result = scheduleSchema.parse(undefined);
    expect(result).toBeUndefined();
  });

  it('should accept disabled field', () => {
    const result = scheduleSchema.parse({
      interval: 86400,
      disabled: true,
    });
    expect(result).toMatchObject({
      interval: 86400,
      day_of_week: null,
      disabled: true,
    });
  });

  it('should reject invalid interval type', () => {
    expect(() => scheduleSchema.parse({
      interval: 'daily',
    })).toThrow();
  });
});
