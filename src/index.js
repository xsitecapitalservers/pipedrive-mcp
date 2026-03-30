/**
 * index.js — Pipedrive MCP Server
 * ─────────────────────────────────────────────
 * Starts an MCP server over HTTP/SSE so it can be hosted on a cloud server
 * and connected to from Claude / Cowork on any machine.
 *
 * Transport: SSE (Server-Sent Events) — the standard for remote MCP servers.
 * Auth:      Bearer token checked on every request (set MCP_AUTH_TOKEN in .env)
 */

import 'dotenv/config';
import express          from 'express';
import { Server }       from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z }            from 'zod';

// Import all tool modules
import { leadTools }       from './tools/leads.js';
import { duplicateTools }  from './tools/duplicates.js';
import { activityTools }   from './tools/activities.js';
import { automationTools } from './tools/automation.js';
import { analysisTools }   from './tools/analysis.js';
import { reportTools }     from './tools/reports.js';

// ── Validate environment variables ────────────────────────────────────────────
const required = ['PIPEDRIVE_API_TOKEN', 'MCP_AUTH_TOKEN'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error(`   Copy .env.example to .env and fill in all values.`);
    process.exit(1);
  }
}

const PORT           = parseInt(process.env.PORT ?? '3000', 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

// ── Collect all tools ─────────────────────────────────────────────────────────
const ALL_TOOLS = [
  ...leadTools,
  ...duplicateTools,
  ...activityTools,
  ...automationTools,
  ...analysisTools,
  ...reportTools,
];

// ── Create MCP Server ─────────────────────────────────────────────────────────
const server = new Server(
  {
    name:    'pipedrive-mcp',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

// Register every tool with the MCP SDK
for (const tool of ALL_TOOLS) {
  server.tool(
    tool.name,
    tool.description,
    tool.schema.shape ?? tool.schema,   // pass the Zod shape
    async (args) => {
      try {
        const result = await tool.handler(args);
        // MCP expects { content: [{ type, text }] }
        return result;
      } catch (err) {
        console.error(`[Tool error: ${tool.name}]`, err);
        return {
          content: [{
            type: 'text',
            text: `❌ Error running "${tool.name}": ${err.message}\n\nCheck your Pipedrive API token and network access.`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ── Express HTTP Server ───────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Simple Bearer-token auth middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] ?? '';
  const token      = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token !== MCP_AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing MCP_AUTH_TOKEN' });
  }
  next();
}

// Health check endpoint (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'pipedrive-mcp',
    tools:  ALL_TOOLS.length,
    time:   new Date().toISOString(),
  });
});

// SSE endpoint — Claude connects here
app.get('/sse', requireAuth, async (req, res) => {
  console.log(`[SSE] New client connected from ${req.ip}`);
  const transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

// Message endpoint — client POSTs tool calls here
app.post('/messages', requireAuth, async (req, res) => {
  // The SSEServerTransport handles this automatically
  res.status(200).end();
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Pipedrive MCP server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`   Tools loaded: ${ALL_TOOLS.length}`);
  console.log(`\n   Tools available:`);
  for (const t of ALL_TOOLS) {
    console.log(`     • ${t.name}`);
  }
  console.log('');
});
