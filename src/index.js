/**
 * index.js — Pipedrive MCP Server
 * ─────────────────────────────────────────────
 * MCP SDK v1.x uses setRequestHandler(), not server.tool().
 * Transport: SSE over HTTP for cloud hosting.
 * Auth: Bearer token on every request.
 */

import 'dotenv/config';
import express from 'express';
import { Server }             from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRequire }      from 'module';

// zodToJsonSchema via CJS (avoids ESM subpath issues with that package)
const _require = createRequire(import.meta.url);
const { zodToJsonSchema } = _require('zod-to-json-schema');

// Tool modules
import { leadTools }       from './tools/leads.js';
import { duplicateTools }  from './tools/duplicates.js';
import { activityTools }   from './tools/activities.js';
import { automationTools } from './tools/automation.js';
import { analysisTools }   from './tools/analysis.js';
import { reportTools }     from './tools/reports.js';

// ── Validate environment ──────────────────────────────────────────────────────
for (const key of ['PIPEDRIVE_API_TOKEN', 'MCP_AUTH_TOKEN']) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env var: ${key}`);
    process.exit(1);
  }
}

const PORT           = parseInt(process.env.PORT ?? '3000', 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

// ── All tools ─────────────────────────────────────────────────────────────────
const ALL_TOOLS = [
  ...leadTools,
  ...duplicateTools,
  ...activityTools,
  ...automationTools,
  ...analysisTools,
  ...reportTools,
];

// ── Create a fresh MCP Server for each SSE connection ────────────────────────
function createMcpServer() {
  const server = new Server(
    { name: 'pipedrive-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Advertise the tool list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map(t => ({
      name:        t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema, { target: 'openApi3' }),
    })),
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = ALL_TOOLS.find(t => t.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: "${request.params.name}"` }],
        isError: true,
      };
    }
    try {
      const args = tool.schema.parse(request.params.arguments ?? {});
      return await tool.handler(args);
    } catch (err) {
      console.error(`[Tool error: ${tool.name}]`, err.message);
      return {
        content: [{ type: 'text', text: `❌ Error in "${tool.name}": ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

function requireAuth(req, res, next) {
  const token = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '').trim();
  if (token !== MCP_AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', server: 'pipedrive-mcp', tools: ALL_TOOLS.length, time: new Date().toISOString() })
);

app.get('/sse', requireAuth, async (req, res) => {
  console.log(`[SSE] Client connected from ${req.ip}`);
  const transport = new SSEServerTransport('/messages', res);
  const server    = createMcpServer();
  await server.connect(transport);
});

app.post('/messages', requireAuth, async (_req, res) => res.status(200).end());

app.listen(PORT, () => {
  console.log(`\n✅ Pipedrive MCP server on port ${PORT} — ${ALL_TOOLS.length} tools loaded`);
  ALL_TOOLS.forEach(t => console.log(`   • ${t.name}`));
});
