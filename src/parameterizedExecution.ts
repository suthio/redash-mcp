import { queryParameterTypeValues } from './parameterManagement.js';

export type QueryParameterType = (typeof queryParameterTypeValues)[number];

export interface QueryParameterDefinition {
  name: string;
  type?: QueryParameterType;
  value?: any;
  multiValuesOptions?: {
    prefix?: string;
    suffix?: string;
    separator?: string;
  } | null;
  useCurrentDateTime?: boolean;
}

export interface BuildParameterizedExecutionOptions {
  useSavedDefaults?: boolean;
  now?: Date;
}

export class ParameterizedExecutionError extends Error {}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function hasOwn(object: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function addDays(value: Date, days: number): Date {
  const result = cloneDate(value);
  result.setDate(result.getDate() + days);
  return result;
}

function addHours(value: Date, hours: number): Date {
  const result = cloneDate(value);
  result.setHours(result.getHours() + hours);
  return result;
}

function addMonths(value: Date, months: number): Date {
  const result = cloneDate(value);
  result.setMonth(result.getMonth() + months);
  return result;
}

function addYears(value: Date, years: number): Date {
  const result = cloneDate(value);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

function startOfDay(value: Date): Date {
  const result = cloneDate(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(value: Date): Date {
  const result = cloneDate(value);
  result.setHours(23, 59, 59, 999);
  return result;
}

function startOfWeek(value: Date): Date {
  return startOfDay(addDays(value, -value.getDay()));
}

function endOfWeek(value: Date): Date {
  return endOfDay(addDays(startOfWeek(value), 6));
}

function startOfMonth(value: Date): Date {
  const result = startOfDay(value);
  result.setDate(1);
  return result;
}

function endOfMonth(value: Date): Date {
  const result = startOfDay(value);
  result.setMonth(result.getMonth() + 1, 0);
  return endOfDay(result);
}

function startOfYear(value: Date): Date {
  const result = startOfDay(value);
  result.setMonth(0, 1);
  return result;
}

function endOfYear(value: Date): Date {
  const result = startOfDay(value);
  result.setMonth(11, 31);
  return endOfDay(result);
}

function formatDateValue(value: Date, type: QueryParameterType): string {
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1);
  const day = pad(value.getDate());
  const hour = pad(value.getHours());
  const minute = pad(value.getMinutes());
  const second = pad(value.getSeconds());

  switch (type) {
    case 'datetime-local':
    case 'datetime-range':
      return `${year}-${month}-${day} ${hour}:${minute}`;
    case 'datetime-with-seconds':
    case 'datetime-range-with-seconds':
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    case 'date':
    case 'date-range':
    default:
      return `${year}-${month}-${day}`;
  }
}

function coerceDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return cloneDate(value);
  }

  if (typeof value === 'number') {
    const result = new Date(value);
    if (!Number.isNaN(result.getTime())) {
      return result;
    }
  }

  if (typeof value === 'string') {
    const result = new Date(value);
    if (!Number.isNaN(result.getTime())) {
      return result;
    }
  }

  throw new ParameterizedExecutionError(`Invalid date value: ${JSON.stringify(value)}`);
}

function resolveDynamicDate(type: QueryParameterType, token: string, now: Date): string | undefined {
  switch (token) {
    case 'now':
      return formatDateValue(now, type);
    case 'yesterday':
      return formatDateValue(addDays(now, -1), type);
    default:
      return undefined;
  }
}

function resolveDynamicDateRange(type: QueryParameterType, token: string, now: Date): { start: string; end: string } | undefined {
  const end = cloneDate(now);
  const range = (() => {
    switch (token) {
      case 'today':
        return [startOfDay(now), endOfDay(now)] as const;
      case 'yesterday':
        return [startOfDay(addDays(now, -1)), endOfDay(addDays(now, -1))] as const;
      case 'this_week':
        return [startOfWeek(now), endOfWeek(now)] as const;
      case 'this_month':
        return [startOfMonth(now), endOfMonth(now)] as const;
      case 'this_year':
        return [startOfYear(now), endOfYear(now)] as const;
      case 'last_week':
        return [startOfWeek(addDays(now, -7)), endOfWeek(addDays(now, -7))] as const;
      case 'last_month':
        return [startOfMonth(addMonths(now, -1)), endOfMonth(addMonths(now, -1))] as const;
      case 'last_year':
        return [startOfYear(addYears(now, -1)), endOfYear(addYears(now, -1))] as const;
      case 'last_hour':
        return [addHours(now, -1), end] as const;
      case 'last_8_hours':
        return [addHours(now, -8), end] as const;
      case 'last_24_hours':
        return [addHours(now, -24), end] as const;
      case 'last_7_days':
        return [startOfDay(addDays(now, -7)), end] as const;
      case 'last_14_days':
        return [startOfDay(addDays(now, -14)), end] as const;
      case 'last_30_days':
        return [startOfDay(addDays(now, -30)), end] as const;
      case 'last_60_days':
        return [startOfDay(addDays(now, -60)), end] as const;
      case 'last_90_days':
        return [startOfDay(addDays(now, -90)), end] as const;
      case 'last_12_months':
        return [startOfDay(addMonths(now, -12)), end] as const;
      case 'last_2_years':
        return [startOfDay(addYears(now, -2)), end] as const;
      case 'last_3_years':
        return [startOfDay(addYears(now, -3)), end] as const;
      case 'last_10_years':
        return [startOfDay(addYears(now, -10)), end] as const;
      default:
        return undefined;
    }
  })();

  if (!range) {
    return undefined;
  }

  return {
    start: formatDateValue(range[0], type),
    end: formatDateValue(range[1], type),
  };
}

function coerceStringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  throw new ParameterizedExecutionError(`Expected a string-like parameter value, got ${JSON.stringify(value)}`);
}

function normalizeTextValue(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    throw new ParameterizedExecutionError(`Expected a scalar parameter value, got ${JSON.stringify(value)}`);
  }

  return coerceStringValue(value);
}

function normalizeNumberValue(value: unknown): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  throw new ParameterizedExecutionError(`Expected a numeric parameter value, got ${JSON.stringify(value)}`);
}

function normalizeListCapableValue(value: unknown, allowMultiple: boolean): string | string[] | null {
  if (value === null) {
    return null;
  }

  if (allowMultiple) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) {
      return null;
    }
    return values.map(coerceStringValue);
  }

  const scalarValue = Array.isArray(value) ? value[0] : value;
  if (scalarValue === undefined || scalarValue === null) {
    return null;
  }
  return coerceStringValue(scalarValue);
}

function normalizeDateParameterValue(type: QueryParameterType, value: unknown, useCurrentDateTime: boolean | undefined, now: Date): string | null {
  if (value === null) {
    return null;
  }

  if (value === undefined && useCurrentDateTime) {
    return formatDateValue(now, type);
  }

  if (typeof value === 'string' && value.startsWith('d_')) {
    const dynamicValue = resolveDynamicDate(type, value.slice(2), now);
    if (dynamicValue !== undefined) {
      return dynamicValue;
    }
  }

  if (isPlainObject(value) && typeof value.dynamic === 'string') {
    const dynamicValue = resolveDynamicDate(type, value.dynamic, now);
    if (dynamicValue !== undefined) {
      return dynamicValue;
    }
  }

  return formatDateValue(coerceDate(value), type);
}

function normalizeDateRangeParameterValue(type: QueryParameterType, value: unknown, now: Date): { start: string; end: string } | null {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' && value.startsWith('d_')) {
    const dynamicValue = resolveDynamicDateRange(type, value.slice(2), now);
    if (dynamicValue !== undefined) {
      return dynamicValue;
    }
  }

  if (isPlainObject(value) && typeof value.dynamic === 'string') {
    const dynamicValue = resolveDynamicDateRange(type, value.dynamic, now);
    if (dynamicValue !== undefined) {
      return dynamicValue;
    }
  }

  const rangeValues = Array.isArray(value)
    ? value
    : isPlainObject(value) && hasOwn(value, 'start') && hasOwn(value, 'end')
      ? [value.start, value.end]
      : undefined;

  if (!rangeValues || rangeValues.length !== 2) {
    throw new ParameterizedExecutionError(`Expected a date range parameter value, got ${JSON.stringify(value)}`);
  }

  return {
    start: formatDateValue(coerceDate(rangeValues[0]), type),
    end: formatDateValue(coerceDate(rangeValues[1]), type),
  };
}

export function normalizeExecutionParameterValue(
  definition: QueryParameterDefinition,
  rawValue: unknown,
  now = new Date()
): unknown {
  const type = definition.type || 'text';
  const allowMultiple = isPlainObject(definition.multiValuesOptions);

  switch (type) {
    case 'number':
      return normalizeNumberValue(rawValue);
    case 'enum':
    case 'query':
      return normalizeListCapableValue(rawValue, allowMultiple);
    case 'date':
    case 'datetime-local':
    case 'datetime-with-seconds':
      return normalizeDateParameterValue(type, rawValue, definition.useCurrentDateTime, now);
    case 'date-range':
    case 'datetime-range':
    case 'datetime-range-with-seconds':
      return normalizeDateRangeParameterValue(type, rawValue, now);
    case 'text':
    case 'text-pattern':
    default:
      return normalizeTextValue(rawValue);
  }
}

export function buildParameterizedExecutionParameters(
  definitions: QueryParameterDefinition[],
  providedParameters: Record<string, unknown> = {},
  options: BuildParameterizedExecutionOptions = {}
): Record<string, unknown> {
  const useSavedDefaults = options.useSavedDefaults ?? true;
  const now = options.now || new Date();

  if (!Array.isArray(definitions) || definitions.length === 0) {
    return structuredClone(providedParameters);
  }

  const definitionNames = new Set(definitions.map((definition) => definition.name));
  const unknownParameterNames = Object.keys(providedParameters).filter((name) => !definitionNames.has(name));
  if (unknownParameterNames.length > 0) {
    throw new ParameterizedExecutionError(`Unknown query parameters: ${unknownParameterNames.join(', ')}`);
  }

  const effectiveParameters: Record<string, unknown> = {};

  for (const definition of definitions) {
    const hasProvidedValue = hasOwn(providedParameters, definition.name);
    const rawValue = hasProvidedValue
      ? providedParameters[definition.name]
      : useSavedDefaults
        ? definition.value
        : undefined;

    if (rawValue === undefined && !(definition.useCurrentDateTime && (definition.type === 'date' || definition.type === 'datetime-local' || definition.type === 'datetime-with-seconds'))) {
      continue;
    }

    effectiveParameters[definition.name] = normalizeExecutionParameterValue(definition, rawValue, now);
  }

  return effectiveParameters;
}
