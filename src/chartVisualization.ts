import { z } from 'zod';

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function mergeDeep<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const result: Record<string, unknown> = cloneValue(base);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = mergeDeep(existing, value);
    } else {
      result[key] = cloneValue(value);
    }
  }

  return result as T;
}

const chartLegendSchema = z.object({
  enabled: z.boolean().optional(),
  placement: z.enum(['auto', 'below']).optional(),
  traceorder: z.enum(['normal', 'reversed']).optional(),
}).passthrough();

const chartDirectionSchema = z.object({
  type: z.enum(['clockwise', 'counterclockwise']).optional(),
}).passthrough();

export const chartVisualizationUpdateSchema = z.object({
  visualizationId: z.coerce.number(),
  type: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  replaceOptions: z.boolean().optional(),
  globalSeriesType: z.enum(chartTypes).optional(),
  sortX: z.boolean().optional(),
  swappedAxes: z.boolean().optional(),
  sortY: z.boolean().optional(),
  reverseY: z.boolean().optional(),
  showpoints: z.boolean().optional(),
  alignYAxesAtZero: z.boolean().optional(),
  legend: chartLegendSchema.optional(),
  xAxis: z.record(z.any()).optional(),
  yAxis: z.array(z.record(z.any())).optional(),
  error_y: z.record(z.any()).optional(),
  series: z.record(z.any()).optional(),
  seriesOptions: z.record(z.any()).optional(),
  valuesOptions: z.record(z.any()).optional(),
  columnMapping: z.record(z.union([z.string(), z.array(z.string()), z.null()])).optional(),
  direction: chartDirectionSchema.optional(),
  sizemode: z.enum(['area', 'diameter']).optional(),
  coefficient: z.number().optional(),
  piesort: z.boolean().optional(),
  color_scheme: z.string().optional(),
  lineShape: z.enum(['linear', 'spline', 'hv', 'vh']).optional(),
  showDataLabels: z.boolean().optional(),
  numberFormat: z.string().optional(),
  percentFormat: z.string().optional(),
  dateTimeFormat: z.string().optional(),
  textFormat: z.string().optional(),
  enableLink: z.boolean().optional(),
  linkOpenNewTab: z.boolean().optional(),
  linkFormat: z.string().optional(),
  missingValuesAsZero: z.boolean().optional(),
  chartOptions: z.record(z.any()).optional(),
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
