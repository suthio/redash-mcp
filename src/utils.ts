export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function cloneValue<T>(value: T): T {
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
