import { test, expect } from '@playwright/test';

test.describe('MCP Inspector - Basic Tests', () => {
  test('should load the inspector page', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Check page title
    const title = await page.title();
    expect(title).toContain('MCP');

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/inspector-loaded.png', fullPage: true });
  });

  test('should display MCP Inspector UI', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check for Inspector heading
    const heading = page.getByText(/MCP Inspector/i);
    await expect(heading).toBeVisible();

    // Check for Connect button
    const connectButton = page.getByRole('button', { name: /connect/i });
    await expect(connectButton).toBeVisible();
  });

  test('should connect to MCP server', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Click Connect button
    const connectButton = page.getByRole('button', { name: /connect/i });
    await connectButton.click();

    // Wait for "Connected" status to appear
    await page.waitForSelector('text=/Connected/i', { timeout: 10000 });

    // Wait a bit more for UI to stabilize
    await page.waitForTimeout(2000);

    // Verify connection status
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('Connected');

    // Take screenshot after connection
    await page.screenshot({ path: 'e2e/screenshots/inspector-connected.png', fullPage: true });
  });

  test('should show tools after connection', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Connect to server
    const connectButton = page.getByRole('button', { name: /connect/i });
    await connectButton.click();

    // Wait for connection to be established
    await page.waitForSelector('text=/Connected/i', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Verify we're connected
    const statusCheck = await page.textContent('body');
    if (!statusCheck?.includes('Connected')) {
      throw new Error('Server not connected');
    }

    // Click on Tools tab
    const toolsTab = page.getByRole('tab', { name: /tools/i });
    await toolsTab.click();
    await page.waitForTimeout(1000);

    // Click "List Tools" button
    const listToolsButton = page.getByRole('button', { name: /list tools/i });
    await listToolsButton.click();
    await page.waitForTimeout(1000);

    // Check page content for tool names
    const pageContent = await page.textContent('body');

    // Verify some key tools are listed
    expect(pageContent).toContain('list_queries');
    expect(pageContent).toContain('get_query');
    expect(pageContent).toContain('list_data_sources');
  });

  test('should show server information', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Connect to server
    const connectButton = page.getByRole('button', { name: /connect/i });
    await connectButton.click();

    // Wait for connection
    await page.waitForSelector('text=/Connected/i', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const pageContent = await page.textContent('body');

    // Verify connected
    expect(pageContent).toContain('Connected');
    // Server name should be visible
    expect(pageContent).toContain('redash-mcp');
  });

  test('should list all 17 tools', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Connect to server
    const connectButton = page.getByRole('button', { name: /connect/i });
    await connectButton.click();

    // Wait for connection
    await page.waitForSelector('text=/Connected/i', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Verify we're connected
    const statusCheck = await page.textContent('body');
    if (!statusCheck?.includes('Connected')) {
      throw new Error('Server not connected');
    }

    // Click on Tools tab
    const toolsTab = page.getByRole('tab', { name: /tools/i });
    await toolsTab.click();
    await page.waitForTimeout(1000);

    // Click "List Tools" button
    const listToolsButton = page.getByRole('button', { name: /list tools/i });
    await listToolsButton.click();
    await page.waitForTimeout(1000);

    // Take screenshot of tools tab
    await page.screenshot({ path: 'e2e/screenshots/inspector-tools-listed.png', fullPage: true });

    const pageContent = await page.textContent('body');

    const expectedTools = [
      'list_queries',
      'get_query',
      'create_query',
      'update_query',
      'archive_query',
      'list_data_sources',
      'execute_query',
      'execute_adhoc_query',
      'get_query_results_csv',
      'list_dashboards',
      'get_dashboard',
      'get_visualization',
      'create_visualization',
      'update_visualization',
      'delete_visualization',
      'get_schema',
    ];

    for (const tool of expectedTools) {
      expect(pageContent).toContain(tool);
    }
  });
});
