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

  it('rejects unknown parameter names when saved definitions exist', () => {
    expect(() => buildParameterizedExecutionParameters(
      [{ name: 'category', type: 'query' }],
      { missing: 'x' }
    )).toThrow(ParameterizedExecutionError);
  });
});
