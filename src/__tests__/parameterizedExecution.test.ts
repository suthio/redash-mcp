import {
  buildParameterizedExecutionParameters,
  normalizeExecutionParameterValue,
  ParameterizedExecutionError,
} from '../parameterizedExecution.js';

describe('parameterizedExecution helpers', () => {
  it('normalizes saved query parameters and applies saved defaults', () => {
    const result = buildParameterizedExecutionParameters(
      [
        { name: 'category', type: 'query' },
        { name: 'flag', type: 'enum', value: 'false' },
        { name: 'segments', type: 'enum', multiValuesOptions: { separator: ',', prefix: "'", suffix: "'" } },
        { name: 'day', type: 'date', value: '2026-04-01' },
      ],
      {
        category: 'example-value',
        flag: true,
        segments: ['alpha', 'beta'],
      },
      { now: new Date(2026, 3, 2, 10, 0, 0) }
    );

    expect(result).toEqual({
      category: 'example-value',
      flag: 'true',
      segments: ['alpha', 'beta'],
      day: '2026-04-01',
    });
  });

  it('resolves dynamic date range defaults', () => {
    const result = buildParameterizedExecutionParameters(
      [
        { name: 'window', type: 'date-range', value: 'd_last_7_days' },
      ],
      {},
      { now: new Date(2026, 3, 2, 10, 0, 0) }
    );

    expect(result).toEqual({
      window: {
        start: '2026-03-26',
        end: '2026-04-02',
      },
    });
  });

  it('supports date range objects and current datetime defaults', () => {
    expect(normalizeExecutionParameterValue(
      { name: 'window', type: 'datetime-range' },
      { start: new Date(2026, 3, 1, 12, 30, 0), end: new Date(2026, 3, 2, 14, 45, 0) },
      new Date(2026, 3, 2, 10, 0, 0)
    )).toEqual({
      start: '2026-04-01 12:30',
      end: '2026-04-02 14:45',
    });

    expect(normalizeExecutionParameterValue(
      { name: 'ts', type: 'datetime-with-seconds', useCurrentDateTime: true },
      undefined,
      new Date(2026, 3, 2, 10, 11, 12)
    )).toEqual('2026-04-02 10:11:12');
  });

  it('supports number, text-pattern, null, and provided-only execution values', () => {
    expect(normalizeExecutionParameterValue(
      { name: 'threshold', type: 'number' },
      '42',
      new Date(2026, 3, 2, 10, 0, 0)
    )).toBe(42);

    expect(normalizeExecutionParameterValue(
      { name: 'pattern', type: 'text-pattern' },
      123,
      new Date(2026, 3, 2, 10, 0, 0)
    )).toBe('123');

    expect(normalizeExecutionParameterValue(
      { name: 'notes', type: 'text' },
      null,
      new Date(2026, 3, 2, 10, 0, 0)
    )).toBeNull();

    expect(buildParameterizedExecutionParameters(
      [
        { name: 'category', type: 'query', value: 'saved-default' },
        { name: 'threshold', type: 'number' },
      ],
      {
        threshold: '7',
      },
      { useSavedDefaults: false, now: new Date(2026, 3, 2, 10, 0, 0) }
    )).toEqual({
      threshold: 7,
    });
  });

  it('resolves dynamic single-date values using ISO-safe parsing', () => {
    const now = new Date(2026, 3, 2, 10, 11, 12);

    expect(normalizeExecutionParameterValue(
      { name: 'ts', type: 'datetime-with-seconds' },
      'd_now',
      now
    )).toBe('2026-04-02 10:11:12');

    expect(normalizeExecutionParameterValue(
      { name: 'day', type: 'date' },
      { dynamic: 'yesterday' },
      now
    )).toBe('2026-04-01');

    expect(normalizeExecutionParameterValue(
      { name: 'day', type: 'date' },
      '2026-04-01',
      now
    )).toBe('2026-04-01');
  });

  it('resolves multiple dynamic date range tokens', () => {
    const now = new Date(2026, 3, 2, 10, 11, 12);

    expect(normalizeExecutionParameterValue(
      { name: 'today', type: 'date-range' },
      'd_today',
      now
    )).toEqual({
      start: '2026-04-02',
      end: '2026-04-02',
    });

    expect(normalizeExecutionParameterValue(
      { name: 'week', type: 'date-range' },
      'd_this_week',
      now
    )).toEqual({
      start: '2026-03-29',
      end: '2026-04-04',
    });

    expect(normalizeExecutionParameterValue(
      { name: 'month', type: 'date-range' },
      'd_last_month',
      now
    )).toEqual({
      start: '2026-03-01',
      end: '2026-03-31',
    });
  });

  it('rejects non-ISO date strings', () => {
    expect(() => normalizeExecutionParameterValue(
      { name: 'day', type: 'date' },
      '04/01/2026',
      new Date(2026, 3, 2, 10, 0, 0)
    )).toThrow(ParameterizedExecutionError);
  });

  it('rejects unknown parameter names when saved definitions exist', () => {
    expect(() => buildParameterizedExecutionParameters(
      [{ name: 'category', type: 'query' }],
      { missing: 'x' }
    )).toThrow(ParameterizedExecutionError);
  });
});
