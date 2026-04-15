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
  col: z.coerce.number().int().min(0).max(dashboardGridDefaults.columns - 1).optional(),
  row: z.coerce.number().int().min(0).optional(),
  sizeX: z.coerce.number().int().min(dashboardGridDefaults.minSizeX).max(dashboardGridDefaults.maxSizeX).optional(),
  sizeY: z.coerce.number().int().min(dashboardGridDefaults.minSizeY).max(dashboardGridDefaults.maxSizeY).optional(),
  autoHeight: z.boolean().optional(),
}).strict();

export const widgetLayoutEntrySchema = z.object({
  widgetId: z.coerce.number(),
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
