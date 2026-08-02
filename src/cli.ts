#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import * as path from 'path';
import { runConfiguredServerCli } from './startup.js';

// Check if .env file exists in current directory and load it
const envPath = path.join(process.cwd(), '.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

// Check required environment variables
const requiredVars = ['REDASH_URL', 'REDASH_API_KEY'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`Error: Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('');
  console.error('Please create a .env file in your current directory with the following variables:');
  console.error('');
  console.error('REDASH_URL=https://your-redash-instance.com');
  console.error('REDASH_API_KEY=your_api_key');
  console.error('');
  console.error('Or provide them when running the command:');
  console.error('');
  console.error('REDASH_URL=https://your-redash-instance.com REDASH_API_KEY=your_key npx @suthio/redash-mcp');
  process.exit(1);
}

await runConfiguredServerCli();
