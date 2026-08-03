/**
 * Integration tests for MCP server
 *
 * These tests verify the integration between different components
 * of the Redash MCP server.
 */

import axios from 'axios';
import { getRedashClient, RedashClient } from '../redashClient.js';
import { toolDefinitions } from '../index.js';
import { logger } from '../logger.js';
import { jest } from '@jest/globals';

// Mock axios to avoid real API calls
jest.mock('axios');

function getToolInputSchema(name: string) {
  const tool = toolDefinitions.find((definition) => definition.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} is not registered`);
  }

  return tool.inputSchema;
}

describe('MCP Server Integration', () => {
  describe('redashClient and logger integration', () => {
    it('should use logger for error reporting', async () => {
      const errorSpy = jest.spyOn(logger, 'error');

      // Mock axios to throw an error
      const mockedAxios = axios as any;

      if (mockedAxios.create) {
        const mockInstance = {
          get: jest.fn<any>().mockRejectedValue(new Error('Network error')),
          defaults: { headers: {} },
        };
        mockedAxios.create.mockReturnValue(mockInstance as any);
      }

      try {
        await getRedashClient().getQueries();
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

      expect(() => new RedashClient()).toThrow();

      // Restore
      process.env.REDASH_URL = originalUrl;
      process.env.REDASH_API_KEY = originalKey;
    });
  });

  describe('Tool schemas validation', () => {
    it('should validate query creation parameters', () => {
      const createQuerySchema = getToolInputSchema('create_query');

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
      const updateQuerySchema = getToolInputSchema('update_query');

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
      const executeQuerySchema = getToolInputSchema('execute_query');

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

    it('should validate parameterized query execution parameters', () => {
      const executeParameterizedQuerySchema = getToolInputSchema('execute_parameterized_query');

      expect(() => executeParameterizedQuerySchema.parse({
        queryId: 123,
        parameters: { category: 'example-value', flag: true },
        useSavedDefaults: true,
        maxAge: 0,
      })).not.toThrow();

      expect(() => executeParameterizedQuerySchema.parse({
        // missing queryId
        parameters: { category: 'example-value' },
      })).toThrow();
    });

    it('should validate visualization creation parameters', () => {
      const createVisualizationSchema = getToolInputSchema('create_visualization');

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

    it('should validate chart visualization update parameters', () => {
      const updateChartVisualizationSchema = getToolInputSchema('update_chart_visualization');

      const validData = {
        visualizationId: 184,
        globalSeriesType: 'column',
        columnMapping: { x: 'send_hour', y: 'clicks' },
        chartOptions: { legend: { enabled: true } },
      };

      expect(() => updateChartVisualizationSchema.parse(validData)).not.toThrow();

      const invalidData = {
        // missing visualizationId
        globalSeriesType: 'column',
      };

      expect(() => updateChartVisualizationSchema.parse(invalidData)).toThrow();
    });
  });
});
