import { z } from 'zod';

export const dashboardGridDefaults = {
  columns: 12,
  defaultSizeX: 6,
  defaultSizeY: 3,
  minSizeX: 2,
  maxSizeX: 12,
  minSizeY: 2,
  maxSizeY: 1000,
};

export const widgetPositionSchema = z.object({
  col: z.coerce.number().int().min(0).max(dashboardGridDefaults.columns - 1).optional().describe('Grid column, starting at 0'),
  row: z.coerce.number().int().min(0).optional().describe('Grid row, starting at 0'),
  sizeX: z.coerce.number().int().min(dashboardGridDefaults.minSizeX).max(dashboardGridDefaults.maxSizeX).optional().describe('Widget width in grid columns'),
  sizeY: z.coerce.number().int().min(dashboardGridDefaults.minSizeY).max(dashboardGridDefaults.maxSizeY).optional().describe('Widget height in grid rows'),
  autoHeight: z.boolean().optional().describe('Whether the widget height should auto-grow'),
}).strict();

export const widgetLayoutEntrySchema = z.object({
  widgetId: z.coerce.number().describe('ID of the widget to move or resize'),
  position: widgetPositionSchema,
});

export type WidgetPositionInput = z.infer<typeof widgetPositionSchema>;

type WidgetLike = {
  id: number;
  visualization_id?: number;
  visualization?: {
    id: number;
    name: string;
    type: string;
  };
  text?: string;
  options?: Record<string, any>;
};

export function buildWidgetLayoutOptions(currentOptions: Record<string, any> | null | undefined, position: WidgetPositionInput) {
  const options = currentOptions || {};
  return {
    ...options,
    position: {
      ...(options.position || {}),
      ...position,
    },
  };
}

export function summarizeWidgetLayout(widget: WidgetLike) {
  return {
    widgetId: widget.id,
    visualizationId: widget.visualization_id ?? widget.visualization?.id,
    visualizationName: widget.visualization?.name,
    visualizationType: widget.visualization?.type,
    text: widget.text,
    isHidden: widget.options?.isHidden ?? false,
    position: widget.options?.position || {},
  };
}
