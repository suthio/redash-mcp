import { scheduleSchema } from '../schedule.js';

describe('scheduleSchema', () => {
  it('should default day_of_week, time, and until to null when omitted', () => {
    const result = scheduleSchema.parse({
      interval: 86400,
    });
    expect(result).toEqual({
      interval: 86400,
      time: null,
      until: null,
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

  it('should accept all valid day_of_week values', () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const day of days) {
      const result = scheduleSchema.parse({ interval: 604800, day_of_week: day });
      expect(result).toMatchObject({ day_of_week: day });
    }
  });

  it('should reject invalid day_of_week string', () => {
    expect(() => scheduleSchema.parse({
      interval: 604800,
      day_of_week: 'monday',
    })).toThrow();
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

  it('should preserve time and until when provided', () => {
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

  it('should require interval', () => {
    expect(() => scheduleSchema.parse({
      time: '01:15',
    })).toThrow();
  });
});
