import { z } from 'zod';
import { cloneValue, mergeDeep } from './utils.js';

const chartTypes = ['line', 'column', 'area', 'pie', 'scatter', 'bubble', 'heatmap', 'box', 'custom'] as const;

const chartOptionKeys = [
  'globalSeriesType',
  'sortX',
  'swappedAxes',
  'sortY',
  'reverseY',
  'showpoints',
  'alignYAxesAtZero',
  'legend',
  'xAxis',
  'yAxis',
  'error_y',
  'series',
  'seriesOptions',
  'valuesOptions',
  'columnMapping',
  'direction',
  'sizemode',
  'coefficient',
  'piesort',
  'color_scheme',
  'lineShape',
  'showDataLabels',
  'numberFormat',
  'percentFormat',
  'dateTimeFormat',
  'textFormat',
  'enableLink',
  'linkOpenNewTab',
  'linkFormat',
  'missingValuesAsZero'
] as const;

const chartLegendSchema = z.object({
  enabled: z.boolean().optional(),
  placement: z.enum(['auto', 'below']).optional(),
  traceorder: z.enum(['normal', 'reversed']).optional(),
}).passthrough().describe('Legend settings');

const chartDirectionSchema = z.object({
  type: z.enum(['clockwise', 'counterclockwise']).optional(),
}).passthrough().describe('Pie chart direction settings');

export const chartVisualizationUpdateSchema = z.object({
  visualizationId: z.coerce.number().describe('ID of the visualization to update'),
  type: z.string().optional().describe('Type of visualization'),
  name: z.string().optional().describe('Name of the visualization'),
  description: z.string().optional().describe('Description of the visualization'),
  replaceOptions: z.boolean().optional().describe('Replace the entire options payload instead of merging with the current config'),
  globalSeriesType: z.enum(chartTypes).optional().describe('Chart type'),
  sortX: z.boolean().optional().describe('Sort the X axis'),
  swappedAxes: z.boolean().optional().describe('Swap the chart axes'),
  sortY: z.boolean().optional().describe('Sort heatmap values'),
  reverseY: z.boolean().optional().describe('Reverse heatmap order'),
  showpoints: z.boolean().optional().describe('Show all points for box charts'),
  alignYAxesAtZero: z.boolean().optional().describe('Align left and right Y axes at zero'),
  legend: chartLegendSchema.optional(),
  xAxis: z.record(z.string(), z.any()).optional().describe('X axis settings'),
  yAxis: z.array(z.record(z.string(), z.any())).optional().describe('Y axis settings'),
  error_y: z.record(z.string(), z.any()).optional().describe('Error bar settings'),
  series: z.record(z.string(), z.any()).optional().describe('Series-wide chart settings'),
  seriesOptions: z.record(z.string(), z.any()).optional().describe('Per-series settings keyed by series name'),
  valuesOptions: z.record(z.string(), z.any()).optional().describe('Per-value settings'),
  columnMapping: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])).optional().describe('Column mappings such as x, y, and series'),
  direction: chartDirectionSchema.optional(),
  sizemode: z.enum(['area', 'diameter']).optional().describe('Bubble size mode'),
  coefficient: z.number().optional().describe('Bubble size coefficient'),
  piesort: z.boolean().optional().describe('Sort pie slices'),
  color_scheme: z.string().optional().describe('Color palette name'),
  lineShape: z.enum(['linear', 'spline', 'hv', 'vh']).optional().describe('Line interpolation'),
  showDataLabels: z.boolean().optional().describe('Toggle data labels'),
  numberFormat: z.string().optional().describe('Number format'),
  percentFormat: z.string().optional().describe('Percent format'),
  dateTimeFormat: z.string().optional().describe('Date/time format'),
  textFormat: z.string().optional().describe('Data label template'),
  enableLink: z.boolean().optional().describe('Enable click-through links'),
  linkOpenNewTab: z.boolean().optional().describe('Open click-through links in a new tab'),
  linkFormat: z.string().optional().describe('Click-through URL template'),
  missingValuesAsZero: z.boolean().optional().describe('Convert missing values to zero'),
  chartOptions: z.record(z.string(), z.any()).optional().describe('Raw Redash chart options to merge into the payload'),
}).strict();

export type ChartVisualizationUpdateInput = z.infer<typeof chartVisualizationUpdateSchema>;

export function buildChartVisualizationOptionsPatch(params: ChartVisualizationUpdateInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const key of chartOptionKeys) {
    const value = params[key];
    if (value !== undefined) {
      patch[key] = cloneValue(value);
    }
  }

  if (params.chartOptions) {
    return mergeDeep(cloneValue(params.chartOptions), patch);
  }

  return patch;
}

export function buildChartVisualizationOptions(
  params: ChartVisualizationUpdateInput,
  currentOptions: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const optionsPatch = buildChartVisualizationOptionsPatch(params);
  return params.replaceOptions ? optionsPatch : mergeDeep((currentOptions ?? {}) as Record<string, unknown>, optionsPatch);
}
