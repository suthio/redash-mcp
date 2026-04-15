import { z } from 'zod';
import { buildInputSchema, zodToJsonSchema } from '../jsonSchema.js';
import { queryParameterPatchSchema } from '../parameterManagement.js';
import { widgetPositionSchema } from '../widgetLayout.js';

describe('jsonSchema helpers', () => {
  it('converts Zod object schemas into JSON schema with defaults and descriptions', () => {
    const schema = buildInputSchema(
      z.object({
        id: z.coerce.number(),
        page: z.coerce.number().optional().default(1),
        options: z.object({
          flag: z.boolean(),
        }).strict(),
        tags: z.array(z.string()).min(1),
        flexible: z.record(z.any()).optional(),
        nullable: z.string().nullable(),
      }).passthrough(),
      {
        id: 'Identifier',
        'options.flag': 'Boolean flag',
      }
    );

    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: true,
      required: ['id', 'options', 'tags', 'nullable'],
      properties: {
        id: { type: 'number', description: 'Identifier' },
        page: { type: 'number', default: 1 },
        options: {
          type: 'object',
          additionalProperties: false,
          required: ['flag'],
          properties: {
            flag: { type: 'boolean', description: 'Boolean flag' },
          },
        },
        tags: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
        },
        flexible: {
          type: 'object',
          additionalProperties: true,
        },
        nullable: {
          type: ['string', 'null'],
        },
      },
    });
  });

  it('preserves shared schema descriptions for query parameters', () => {
    const schema = buildInputSchema(z.object({
      parameters: z.array(queryParameterPatchSchema),
    }), {
      parameters: 'Parameter definitions to merge',
    });

    expect(schema).toMatchObject({
      properties: {
        parameters: {
          description: 'Parameter definitions to merge',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['name'],
            properties: {
              name: { description: 'Parameter name' },
              enumOptions: { description: 'Dropdown options' },
              multiValuesOptions: { description: 'Multi-value formatting options' },
            },
          },
        },
      },
    });
  });

  it('converts widget position constraints from the shared Zod schema', () => {
    const schema = zodToJsonSchema(widgetPositionSchema);

    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        col: { type: 'integer', minimum: 0, maximum: 11, description: 'Grid column, starting at 0' },
        row: { type: 'integer', minimum: 0, description: 'Grid row, starting at 0' },
        sizeX: { type: 'integer', minimum: 2, maximum: 12, description: 'Widget width in grid columns' },
        sizeY: { type: 'integer', minimum: 2, maximum: 1000, description: 'Widget height in grid rows' },
        autoHeight: { type: 'boolean', description: 'Whether the widget height should auto-grow' },
      },
    });
  });
});
