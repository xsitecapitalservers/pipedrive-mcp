/**
 * index.js — Pipedrive MCP Server
 * ─────────────────────────────────────────────
 * MCP SDK v1.x SSE transport pattern:
 *   GET  /sse       — client connects, server streams events back
 *   POST /messages  — client sends tool-call messages (must include ?sessionId=)
 */

import 'dotenv/config';
import express from 'express';
import { Server }             from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const { zodToJsonSchema } = _require('zod-to-json-schema');

import { leadTools }       from './tools/leads.js';
import { duplicateTools }  from './tools/duplicates.js';
import { activityTools }   from './tools/activities.js';
import { automationTools } from './tools/automation.js';
import { analysisTools }   from './tools/analysis.js';
import { reportTools }     from './tools/reports.js';

// ── Validate environment ──────────────────────────────────────────────────────
if (!process.env.PIPEDRIVE_API_TOKEN) {
  console.error('❌ Missing required env var: PIPEDRIVE_API_TOKEN');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ── All tools ─────────────────────────────────────────────────────────────────
const ALL_TOOLS = [
  ...leadTools,
  ...duplicateTools,
  ...activityTools,
  ...automationTools,
  ...analysisTools,
  ...reportTools,
];

// ── Active transports — keyed by sessionId ────────────────────────────────────
// The SSE client receives its sessionId via the stream, then uses it on POST /messages
const activeTransports = new Map();

// ── MCP server factory ────────────────────────────────────────────────────────
function createMcpServer() {
  const server = new Server(
    { name: 'pipedrive-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map(t => ({
      name:        t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema, { target: 'openApi3' }),
    })),
  }));

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

// CORS — allow Cowork/Claude to connect from any origin
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', server: 'pipedrive-mcp', tools: ALL_TOOLS.length, time: new Date().toISOString() })
);

// SSE endpoint — auth required here; client gets a sessionId back via the stream
app.get('/sse', async (req, res) => {
  console.log(`[SSE] Client connected from ${req.ip}`);
  const transport = new SSEServerTransport('/messages', res);

  // Store so POST /messages can route to the right transport
  activeTransports.set(transport.sessionId, transport);
  console.log(`[SSE] Session ${transport.sessionId} registered`);

  req.on('close', () => {
    activeTransports.delete(transport.sessionId);
    console.log(`[SSE] Session ${transport.sessionId} closed`);
  });

  const server = createMcpServer();
  await server.connect(transport);
});

// Message endpoint — no separate auth; sessionId links to an already-authenticated transport
app.post('/messages', async (req, res) => {
  const sessionId  = req.query.sessionId;
  const transport  = activeTransports.get(sessionId);

  if (!transport) {
    console.warn(`[Messages] Unknown sessionId: ${sessionId}`);
    return res.status(400).json({ error: `No active session for sessionId: ${sessionId}` });
  }

  await transport.handlePostMessage(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`\n✅ Pipedrive MCP server on port ${PORT} — ${ALL_TOOLS.length} tools loaded`);
  ALL_TOOLS.forEach(t => console.log(`   • ${t.name}`));
});
