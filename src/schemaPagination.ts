export const DEFAULT_SCHEMA_PAGE_SIZE = 25;
export const MAX_SCHEMA_PAGE_SIZE = 100;

export function schemaPageOffset(page: number, pageSize: number): number {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error('page must be a positive integer');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_SCHEMA_PAGE_SIZE) {
    throw new Error(`pageSize must be an integer between 1 and ${MAX_SCHEMA_PAGE_SIZE}`);
  }

  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    throw new Error('page and pageSize produce an unsupported offset');
  }

  return offset;
}
