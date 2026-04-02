import { z } from 'zod';

export const queryParameterTypeValues = [
  'text',
  'text-pattern',
  'number',
  'enum',
  'query',
  'date',
  'datetime-local',
  'datetime-with-seconds',
  'date-range',
  'datetime-range',
  'datetime-range-with-seconds'
] as const;

export const widgetParameterMappingTypeValues = [
  'dashboard-level',
  'widget-level',
  'static-value'
] as const;

function isPlainObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function mergeDeep<T extends Record<string, any>>(base: T, patch: Record<string, any>): T {
  const result: Record<string, any> = cloneValue(base);

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

const multiValuesOptionsSchema = z.object({
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  separator: z.string().optional()
}).passthrough();

export const queryParameterSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  type: z.enum(queryParameterTypeValues).optional(),
  value: z.any().optional(),
  global: z.boolean().optional(),
  regex: z.string().optional(),
  enumOptions: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  queryId: z.coerce.number().optional(),
  multiValuesOptions: z.union([multiValuesOptionsSchema, z.null()]).optional()
}).passthrough();

export const queryParameterPatchSchema = queryParameterSchema.partial().extend({
  name: z.string()
}).passthrough();

export const widgetParameterMappingSchema = z.object({
  name: z.string(),
  type: z.enum(widgetParameterMappingTypeValues).optional(),
  mapTo: z.string().optional(),
  value: z.any().optional(),
  title: z.string().optional()
}).passthrough();

export const widgetParameterMappingPatchSchema = widgetParameterMappingSchema.partial().extend({
  name: z.string()
}).passthrough();

export interface MergeNamedEntriesOptions {
  replace?: boolean;
  removeNames?: string[];
}

export function mergeNamedEntries<T extends { name: string }>(
  existing: T[],
  patches: Array<Partial<T> & { name: string }>,
  options: MergeNamedEntriesOptions = {}
): T[] {
  const existingByName = new Map(existing.map((item) => [item.name, cloneValue(item)] as const));
  const result: T[] = options.replace ? [] : existing.map((item) => cloneValue(item));
  const indexByName = new Map<string, number>();

  result.forEach((item, index) => {
    indexByName.set(item.name, index);
  });

  for (const patch of patches) {
    const patchValue = cloneValue(patch) as Record<string, any> & { name: string };
    const currentIndex = indexByName.get(patch.name);
    const baseValue = existingByName.get(patch.name);
    const mergedValue = baseValue ? mergeDeep(baseValue, patchValue) : patchValue;

    if (currentIndex !== undefined) {
      result[currentIndex] = mergedValue as T;
    } else {
      indexByName.set(patch.name, result.length);
      result.push(mergedValue as T);
    }
  }

  const removeNames = new Set(options.removeNames || []);
  return result.filter((item) => !removeNames.has(item.name));
}

export function toNamedEntries(record: Record<string, any> | null | undefined): Array<Record<string, any> & { name: string }> {
  if (!isPlainObject(record)) {
    return [];
  }

  return Object.entries(record).map(([name, value]) => ({
    ...(isPlainObject(value) ? cloneValue(value) : {}),
    name
  }));
}

export function toNamedRecord(entries: Array<Record<string, any> & { name: string }>): Record<string, Record<string, any>> {
  return Object.fromEntries(entries.map((entry) => [entry.name, cloneValue(entry)]));
}

export function resolveParameterOrder(
  currentOrder: string[] | null | undefined,
  names: string[],
  options: { replace?: boolean; explicitOrder?: string[] } = {}
): string[] {
  const finalNames = names.filter((name) => !!name);

  if (options.explicitOrder) {
    const order: string[] = [];
    for (const name of options.explicitOrder) {
      if (finalNames.includes(name) && !order.includes(name)) {
        order.push(name);
      }
    }
    for (const name of finalNames) {
      if (!order.includes(name)) {
        order.push(name);
      }
    }
    return order;
  }

  if (options.replace || !Array.isArray(currentOrder)) {
    return finalNames;
  }

  const order: string[] = [];
  for (const name of currentOrder) {
    if (finalNames.includes(name) && !order.includes(name)) {
      order.push(name);
    }
  }
  for (const name of finalNames) {
    if (!order.includes(name)) {
      order.push(name);
    }
  }
  return order;
}
