/**
 * index.js — Pipedrive MCP Server
 * ─────────────────────────────────────────────
 * Uses StreamableHTTPServerTransport (the modern MCP transport).
 * Single endpoint: POST /mcp  (also handles GET for SSE streaming)
 * Legacy SSE endpoints kept at /sse + /messages for backward compat.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server }                        from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport }            from '@modelcontextprotocol/sdk/server/sse.js';
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, mcp-session-id');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  if (_req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', server: 'pipedrive-mcp', tools: ALL_TOOLS.length, time: new Date().toISOString() })
);

// ── Modern StreamableHTTP endpoint (/mcp) ─────────────────────────────────────
// Cowork uses this protocol. Single endpoint handles GET + POST.
const streamableTransports = new Map(); // sessionId → transport

app.all('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];

  // Re-use existing transport for this session
  if (sessionId && streamableTransports.has(sessionId)) {
    const transport = streamableTransports.get(sessionId);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — only POST (initialize) should create a new transport
  if (req.method !== 'POST') {
    res.status(400).json({ error: 'No session found. Send POST to initialize.' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  transport.onclose = () => {
    if (transport.sessionId) streamableTransports.delete(transport.sessionId);
    console.log(`[MCP] Session ${transport.sessionId} closed`);
  };

  const server = createMcpServer();
  await server.connect(transport);

  // Handle the initialize request — after connect the sessionId is set
  await transport.handleRequest(req, res, req.body);

  if (transport.sessionId) {
    streamableTransports.set(transport.sessionId, transport);
    console.log(`[MCP] New session ${transport.sessionId}`);
  }
});

// ── Legacy SSE endpoints (/sse + /messages) ───────────────────────────────────
// Kept for any older clients that still use the SSE protocol.
const sseTransports = new Map();

app.get('/sse', async (req, res) => {
  console.log(`[SSE] Client connected`);
  const transport = new SSEServerTransport('/messages', res);
  sseTransports.set(transport.sessionId, transport);
  req.on('close', () => sseTransports.delete(transport.sessionId));
  const server = createMcpServer();
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports.get(sessionId);
  if (!transport) return res.status(400).json({ error: `No session: ${sessionId}` });
  await transport.handlePostMessage(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`\n✅ Pipedrive MCP server on port ${PORT} — ${ALL_TOOLS.length} tools loaded`);
  console.log(`   StreamableHTTP: POST /mcp`);
  console.log(`   Legacy SSE:     GET  /sse`);
  ALL_TOOLS.forEach(t => console.log(`   • ${t.name}`));
});
