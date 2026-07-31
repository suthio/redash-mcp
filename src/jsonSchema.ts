import { ZodFirstPartyTypeKind, type ZodTypeAny } from 'zod';

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: Array<string | number>;
  const?: string | number | boolean | null;
  oneOf?: JsonSchema[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

export type JsonSchemaDescriptionMap = Record<string, string>;

function getDescription(schema: ZodTypeAny): string | undefined {
  return (schema._def as { description?: string }).description;
}

function withDescription(base: JsonSchema, schema: ZodTypeAny): JsonSchema {
  const description = getDescription(schema);
  return description ? { ...base, description } : base;
}

function isInputOptional(schema: ZodTypeAny): boolean {
  switch (schema._def.typeName) {
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodDefault:
      return true;
    case ZodFirstPartyTypeKind.ZodEffects:
      return isInputOptional((schema._def as { schema: ZodTypeAny }).schema);
    default:
      return false;
  }
}

function mergeNullableSchema(schema: JsonSchema): JsonSchema {
  if (typeof schema.type === 'string') {
    return { ...schema, type: [schema.type, 'null'] };
  }

  if (Array.isArray(schema.type)) {
    return schema.type.includes('null') ? schema : { ...schema, type: [...schema.type, 'null'] };
  }

  return { oneOf: [schema, { type: 'null' }] };
}

function simpleUnionTypes(schemas: JsonSchema[]): string[] | undefined {
  const types = schemas.map((schema) => {
    if (typeof schema.type === 'string' && Object.keys(schema).length === 1) {
      return schema.type;
    }
    return undefined;
  });

  return types.every((type): type is string => !!type) ? types : undefined;
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  switch (schema._def.typeName) {
    case ZodFirstPartyTypeKind.ZodString: {
      const result: JsonSchema = { type: 'string' };
      for (const check of (schema._def as { checks?: Array<{ kind: string; value?: number }> }).checks ?? []) {
        if (check.kind === 'min' && typeof check.value === 'number') {
          result.minLength = check.value;
        }
        if (check.kind === 'max' && typeof check.value === 'number') {
          result.maxLength = check.value;
        }
      }
      return withDescription(result, schema);
    }
    case ZodFirstPartyTypeKind.ZodNumber: {
      const checks = (schema._def as { checks?: Array<{ kind: string; value?: number }> }).checks ?? [];
      const result: JsonSchema = {
        type: checks.some((check) => check.kind === 'int') ? 'integer' : 'number',
      };

      for (const check of checks) {
        if (check.kind === 'min' && typeof check.value === 'number') {
          result.minimum = check.value;
        }
        if (check.kind === 'max' && typeof check.value === 'number') {
          result.maximum = check.value;
        }
      }

      return withDescription(result, schema);
    }
    case ZodFirstPartyTypeKind.ZodBoolean:
      return withDescription({ type: 'boolean' }, schema);
    case ZodFirstPartyTypeKind.ZodNull:
      return withDescription({ type: 'null' }, schema);
    case ZodFirstPartyTypeKind.ZodAny:
    case ZodFirstPartyTypeKind.ZodUnknown:
      return withDescription({}, schema);
    case ZodFirstPartyTypeKind.ZodArray: {
      const def = schema._def as { type: ZodTypeAny; minLength: { value: number } | null; maxLength: { value: number } | null };
      const result: JsonSchema = {
        type: 'array',
        items: zodToJsonSchema(def.type),
      };

      if (def.minLength) {
        result.minItems = def.minLength.value;
      }
      if (def.maxLength) {
        result.maxItems = def.maxLength.value;
      }

      return withDescription(result, schema);
    }
    case ZodFirstPartyTypeKind.ZodEnum:
      return withDescription({ type: 'string', enum: [...(schema._def as { values: string[] }).values] }, schema);
    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      const values = Object.values((schema._def as { values: Record<string, string | number> }).values).filter(
        (value) => typeof value === 'string' || typeof value === 'number'
      );
      const primitiveType = values.every((value) => typeof value === 'number') ? 'number' : 'string';
      return withDescription({ type: primitiveType, enum: values }, schema);
    }
    case ZodFirstPartyTypeKind.ZodLiteral: {
      const value = (schema._def as { value: string | number | boolean | null }).value;
      return withDescription({ type: value === null ? 'null' : typeof value, const: value }, schema);
    }
    case ZodFirstPartyTypeKind.ZodObject: {
      const def = schema._def as {
        shape: () => Record<string, ZodTypeAny>;
        unknownKeys: 'strict' | 'strip' | 'passthrough';
        catchall: ZodTypeAny;
      };
      const shape = def.shape();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!isInputOptional(value)) {
          required.push(key);
        }
      }

      const result: JsonSchema = {
        type: 'object',
        properties,
      };

      if (required.length > 0) {
        result.required = required;
      }

      if (def.unknownKeys === 'strict') {
        result.additionalProperties = false;
      } else if (def.catchall._def.typeName !== ZodFirstPartyTypeKind.ZodNever) {
        result.additionalProperties = zodToJsonSchema(def.catchall);
      } else if (def.unknownKeys === 'passthrough') {
        result.additionalProperties = true;
      }

      return withDescription(result, schema);
    }
    case ZodFirstPartyTypeKind.ZodRecord: {
      const def = schema._def as { valueType: ZodTypeAny };
      const valueSchema = zodToJsonSchema(def.valueType);
      return withDescription(
        {
          type: 'object',
          additionalProperties: Object.keys(valueSchema).length === 0 ? true : valueSchema,
        },
        schema
      );
    }
    case ZodFirstPartyTypeKind.ZodUnion: {
      const options = (schema._def as { options: ZodTypeAny[] }).options.map(zodToJsonSchema);
      const simpleTypes = simpleUnionTypes(options);
      return withDescription(simpleTypes ? { type: simpleTypes } : { oneOf: options }, schema);
    }
    case ZodFirstPartyTypeKind.ZodNullable:
      return withDescription(mergeNullableSchema(zodToJsonSchema((schema._def as { innerType: ZodTypeAny }).innerType)), schema);
    case ZodFirstPartyTypeKind.ZodOptional:
      return withDescription(zodToJsonSchema((schema._def as { innerType: ZodTypeAny }).innerType), schema);
    case ZodFirstPartyTypeKind.ZodDefault: {
      const def = schema._def as { innerType: ZodTypeAny; defaultValue: () => unknown };
      return withDescription({ ...zodToJsonSchema(def.innerType), default: def.defaultValue() }, schema);
    }
    case ZodFirstPartyTypeKind.ZodEffects:
      return withDescription(zodToJsonSchema((schema._def as { schema: ZodTypeAny }).schema), schema);
    default:
      throw new Error(`Unsupported Zod schema for JSON schema conversion: ${schema._def.typeName}`);
  }
}

function resolvePath(schema: JsonSchema, path: string): JsonSchema {
  let current = schema;

  if (!path) {
    return current;
  }

  for (const rawSegment of path.split('.')) {
    const isArraySegment = rawSegment.endsWith('[]');
    const segment = isArraySegment ? rawSegment.slice(0, -2) : rawSegment;

    if (segment) {
      if (!current.properties || !current.properties[segment]) {
        throw new Error(`Unable to apply JSON schema description at path "${path}"`);
      }
      current = current.properties[segment];
    }

    if (isArraySegment) {
      if (!current.items) {
        throw new Error(`Unable to apply JSON schema description at path "${path}"`);
      }
      current = current.items;
    }
  }

  return current;
}

export function applyJsonSchemaDescriptions(schema: JsonSchema, descriptions: JsonSchemaDescriptionMap = {}): JsonSchema {
  const result = structuredClone(schema);

  for (const [path, description] of Object.entries(descriptions)) {
    resolvePath(result, path).description = description;
  }

  return result;
}

export function buildInputSchema(schema: ZodTypeAny, descriptions: JsonSchemaDescriptionMap = {}): JsonSchema {
  return applyJsonSchemaDescriptions(zodToJsonSchema(schema), descriptions);
}
