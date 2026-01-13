/**
 * Integration tests for MCP server
 *
 * These tests verify the integration between different components
 * of the Redash MCP server.
 */

// Set environment variables before any imports
process.env.REDASH_URL = 'https://redash.example.com';
process.env.REDASH_API_KEY = 'test-api-key';
process.env.REDASH_TIMEOUT = '30000';

import { redashClient } from '../redashClient.js';
import { logger } from '../logger.js';
import { jest } from '@jest/globals';

// Mock axios to avoid real API calls
jest.mock('axios');

describe('MCP Server Integration', () => {
  beforeEach(() => {
    // Set up environment variables for testing
    process.env.REDASH_URL = 'https://redash.example.com';
    process.env.REDASH_API_KEY = 'test-api-key';
  });

  describe('redashClient and logger integration', () => {
    it('should use logger for error reporting', async () => {
      const errorSpy = jest.spyOn(logger, 'error');

      // Mock axios to throw an error
      const axios = await import('axios');
      const mockedAxios = axios as any;

      if (mockedAxios.create) {
        const mockInstance = {
          get: jest.fn<any>().mockRejectedValue(new Error('Network error')),
          defaults: { headers: {} },
        };
        mockedAxios.create.mockReturnValue(mockInstance as any);
      }

      try {
        await redashClient.getQueries();
      } catch (error) {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('Environment configuration', () => {
    it('should require REDASH_URL and REDASH_API_KEY', () => {
      const originalUrl = process.env.REDASH_URL;
      const originalKey = process.env.REDASH_API_KEY;

      delete process.env.REDASH_URL;
      delete process.env.REDASH_API_KEY;

      // This should be tested in RedashClient constructor
      expect(() => {
        // Constructor is called when importing, so we need to re-import
        const { RedashClient } = require('../redashClient.js');
        new RedashClient();
      }).toThrow();

      // Restore
      process.env.REDASH_URL = originalUrl;
      process.env.REDASH_API_KEY = originalKey;
    });
  });

  describe('Tool schemas validation', () => {
    it('should validate query creation parameters', () => {
      const { z } = require('zod');

      const createQuerySchema = z.object({
        name: z.string(),
        data_source_id: z.number(),
        query: z.string(),
        description: z.string().optional(),
        options: z.any().optional(),
        schedule: z.any().optional(),
        tags: z.array(z.string()).optional()
      });

      const validData = {
        name: 'Test Query',
        data_source_id: 1,
        query: 'SELECT 1',
      };

      expect(() => createQuerySchema.parse(validData)).not.toThrow();

      const invalidData = {
        name: 'Test Query',
        // missing data_source_id
        query: 'SELECT 1',
      };

      expect(() => createQuerySchema.parse(invalidData)).toThrow();
    });

    it('should validate query update parameters', () => {
      const { z } = require('zod');

      const updateQuerySchema = z.object({
        queryId: z.number(),
        name: z.string().optional(),
        data_source_id: z.number().optional(),
        query: z.string().optional(),
        description: z.string().optional(),
        options: z.any().optional(),
        schedule: z.any().optional(),
        tags: z.array(z.string()).optional(),
        is_archived: z.boolean().optional(),
        is_draft: z.boolean().optional()
      });

      const validData = {
        queryId: 123,
        name: 'Updated Query',
      };

      expect(() => updateQuerySchema.parse(validData)).not.toThrow();

      const invalidData = {
        // missing queryId
        name: 'Updated Query',
      };

      expect(() => updateQuerySchema.parse(invalidData)).toThrow();
    });

    it('should validate execute query parameters', () => {
      const { z } = require('zod');

      const executeQuerySchema = z.object({
        queryId: z.number(),
        parameters: z.record(z.any()).optional()
      });

      const validData = {
        queryId: 123,
        parameters: { date: '2024-01-01' },
      };

      expect(() => executeQuerySchema.parse(validData)).not.toThrow();

      const validDataWithoutParams = {
        queryId: 123,
      };

      expect(() => executeQuerySchema.parse(validDataWithoutParams)).not.toThrow();
    });

    it('should validate visualization creation parameters', () => {
      const { z } = require('zod');

      const createVisualizationSchema = z.object({
        query_id: z.number(),
        type: z.string(),
        name: z.string(),
        description: z.string().optional(),
        options: z.any()
      });

      const validData = {
        query_id: 1,
        type: 'CHART',
        name: 'Test Chart',
        options: { chartType: 'bar' },
      };

      expect(() => createVisualizationSchema.parse(validData)).not.toThrow();

      const invalidData = {
        query_id: 1,
        type: 'CHART',
        // missing name and options
      };

      expect(() => createVisualizationSchema.parse(invalidData)).toThrow();
    });
  });

  describe('Resource URI parsing', () => {
    it('should parse query resource URIs', () => {
      const uri = 'redash://query/123';
      const match = uri.match(/^redash:\/\/(query|dashboard)\/(\d+)$/);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('query');
      expect(match![2]).toBe('123');
    });

    it('should parse dashboard resource URIs', () => {
      const uri = 'redash://dashboard/456';
      const match = uri.match(/^redash:\/\/(query|dashboard)\/(\d+)$/);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('dashboard');
      expect(match![2]).toBe('456');
    });

    it('should reject invalid resource URIs', () => {
      const invalidUris = [
        'redash://invalid/123',
        'redash://query/abc',
        'invalid://query/123',
        'redash://query',
      ];

      invalidUris.forEach((uri) => {
        const match = uri.match(/^redash:\/\/(query|dashboard)\/(\d+)$/);
        expect(match).toBeNull();
      });
    });
  });
});
