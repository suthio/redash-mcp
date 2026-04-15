import { buildWidgetLayoutOptions, dashboardGridDefaults, summarizeWidgetLayout, widgetPositionSchema } from '../widgetLayout.js';

describe('widgetLayout helpers', () => {
  it('merges a position patch into widget options', () => {
    expect(buildWidgetLayoutOptions(
      {
        isHidden: false,
        position: { col: 1, row: 2, sizeX: 3, sizeY: 4, autoHeight: false },
      },
      { row: 5, sizeX: 6 }
    )).toEqual({
      isHidden: false,
      position: { col: 1, row: 5, sizeX: 6, sizeY: 4, autoHeight: false },
    });
  });

  it('summarizes widget layout details', () => {
    expect(summarizeWidgetLayout({
      id: 12,
      visualization: { id: 44, name: 'CTR by Hour', type: 'CHART' },
      text: '',
      options: { isHidden: true, position: { col: 3, row: 6, sizeX: 4, sizeY: 8 } },
    })).toEqual({
      widgetId: 12,
      visualizationId: 44,
      visualizationName: 'CTR by Hour',
      visualizationType: 'CHART',
      text: '',
      isHidden: true,
      position: { col: 3, row: 6, sizeX: 4, sizeY: 8 },
    });
  });

  it('validates widget positions and exposes grid defaults', () => {
    expect(() => widgetPositionSchema.parse({ col: 0, row: 1, sizeX: 6, sizeY: 4, autoHeight: false })).not.toThrow();
    expect(() => widgetPositionSchema.parse({ col: 12, row: 1, sizeX: 6, sizeY: 4 })).toThrow();
    expect(() => widgetPositionSchema.parse({ col: 0, row: 1, sizeX: 1, sizeY: 4 })).toThrow();
    expect(() => widgetPositionSchema.parse({ col: 0, row: 1, sizeX: 6, sizeY: 1001 })).toThrow();
    expect(dashboardGridDefaults.columns).toBe(12);
  });
});
