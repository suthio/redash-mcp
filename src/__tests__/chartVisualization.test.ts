import { buildChartVisualizationOptions, buildChartVisualizationOptionsPatch, chartVisualizationUpdateSchema } from '../chartVisualization.js';
import { mergeDeep } from '../utils.js';

describe('chartVisualization helpers', () => {
  it('deep-merges chart option patches', () => {
    const base = {
      legend: { enabled: true, placement: 'auto', traceorder: 'normal' },
      seriesOptions: {
        clicks: { color: '#f00', yAxis: 1 },
      },
      yAxis: [{ type: 'linear' }, { type: 'linear', opposite: true }],
    };

    const patch = {
      legend: { placement: 'below' },
      seriesOptions: {
        clicks: { color: '#00f' },
      },
      yAxis: [{ type: 'logarithmic' }],
    };

    const result = mergeDeep(base, patch);

    expect(result).toEqual({
      legend: { enabled: true, placement: 'below', traceorder: 'normal' },
      seriesOptions: {
        clicks: { color: '#00f', yAxis: 1 },
      },
      yAxis: [{ type: 'logarithmic' }],
    });
    expect(base.legend.placement).toBe('auto');
  });

  it('builds a chart options patch from the typed update input', () => {
    const input = chartVisualizationUpdateSchema.parse({
      visualizationId: 184,
      globalSeriesType: 'column',
      sortX: true,
      chartOptions: {
        legend: { enabled: false, placement: 'auto' },
        series: { stacking: 'stack' },
      },
      legend: { placement: 'below' },
    });

    expect(buildChartVisualizationOptionsPatch(input)).toEqual({
      globalSeriesType: 'column',
      sortX: true,
      legend: { enabled: false, placement: 'below' },
      series: { stacking: 'stack' },
    });
  });

  it('replaces existing chart options when replaceOptions is enabled', () => {
    const input = chartVisualizationUpdateSchema.parse({
      visualizationId: 184,
      replaceOptions: true,
      legend: { enabled: false },
      chartOptions: {
        series: { stacking: 'stack' },
      },
    });

    expect(buildChartVisualizationOptions(input, {
      legend: { enabled: true, placement: 'below' },
      columnMapping: { x: 'send_hour' },
    })).toEqual({
      legend: { enabled: false },
      series: { stacking: 'stack' },
    });
  });
});
