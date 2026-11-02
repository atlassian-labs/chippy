import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { createHelperConnection } from './helper';
import { registerChippyTools } from './tools';

// Built beside the helper inside the relocatable skill; never depend on cwd.
const helper = createHelperConnection(resolve(__dirname, '..'), Number(process.env.CHIPPY_HELPER_PORT || 7823));
const server = new McpServer({ name: 'chippy', version: '0.1.0' }, {
  instructions: 'Use Chippy runtime evidence before source search. Start with chippy_status and chippy_pages, select the page by URL/title, and read a snapshot. Follow the Chippy skill for investigation and active-stimulus gates. The helper starts automatically and persists across sessions. stdout is reserved for MCP.',
});
registerChippyTools(server, helper);
const transport = new StdioServerTransport();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  // The shared helper deliberately outlives this MCP connection.
}
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
process.stdin.once('end', () => { void close(); });
server.connect(transport).then(() => helper.ensure()).catch(error => {
  console.error(`[chippy-mcp] ${error.message}`);
});
