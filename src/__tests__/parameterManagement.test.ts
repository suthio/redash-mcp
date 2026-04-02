import {
  mergeNamedEntries,
  queryParameterPatchSchema,
  resolveParameterOrder,
  toNamedEntries,
  toNamedRecord,
  widgetParameterMappingPatchSchema,
} from '../parameterManagement.js';

describe('parameterManagement helpers', () => {
  it('merges named entries without losing existing fields', () => {
    const result = mergeNamedEntries(
      [
        {
          name: 'stage1',
          title: 'Stage 1',
          type: 'text',
          value: 'a',
          multiValuesOptions: { prefix: '', suffix: '', separator: ',' },
        },
        {
          name: 'stage2',
          title: 'Stage 2',
          type: 'number',
        },
      ],
      [
        {
          name: 'stage1',
          title: 'Primary Stage',
          multiValuesOptions: { prefix: '"' } as any,
        } as any,
        {
          name: 'stage3',
          type: 'enum',
          enumOptions: 'a\nb',
        } as any,
      ],
      { removeNames: ['stage2'] }
    );

    expect(result).toEqual([
      {
        name: 'stage1',
        title: 'Primary Stage',
        type: 'text',
        value: 'a',
        multiValuesOptions: { prefix: '"', suffix: '', separator: ',' },
      },
      {
        name: 'stage3',
        type: 'enum',
        enumOptions: 'a\nb',
      },
    ]);
  });

  it('resolves parameter order with explicit and preserved ordering', () => {
    expect(resolveParameterOrder(['a', 'b'], ['b', 'c'])).toEqual(['b', 'c']);
    expect(resolveParameterOrder(['a', 'b'], ['b', 'c'], { explicitOrder: ['c'] })).toEqual(['c', 'b']);
  });

  it('round-trips named records for widget mappings', () => {
    const entries = toNamedEntries({
      stage1: { type: 'dashboard-level', mapTo: 'stage1', title: 'Stage 1' },
      stage2: { type: 'static-value', value: 'x' },
    });

    expect(entries).toEqual([
      { name: 'stage1', type: 'dashboard-level', mapTo: 'stage1', title: 'Stage 1' },
      { name: 'stage2', type: 'static-value', value: 'x' },
    ]);
    expect(toNamedRecord(entries)).toEqual({
      stage1: { name: 'stage1', type: 'dashboard-level', mapTo: 'stage1', title: 'Stage 1' },
      stage2: { name: 'stage2', type: 'static-value', value: 'x' },
    });
  });

  it('validates query and widget parameter patches', () => {
    expect(() =>
      queryParameterPatchSchema.parse({
        name: 'stage1',
        type: 'enum',
        enumOptions: ['a', 'b'],
      } as any)
    ).not.toThrow();

    expect(() =>
      widgetParameterMappingPatchSchema.parse({
        name: 'stage1',
        type: 'dashboard-level',
        mapTo: 'stage1',
      } as any)
    ).not.toThrow();
  });
});
