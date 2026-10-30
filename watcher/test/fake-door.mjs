// A tiny MCP server that speaks door_status and read_room. Not the Seed Door.
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startFakeDoor(world) {
  const httpServer = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end('{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}');
      return;
    }
    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"},"id":null}');
      return;
    }
    const server = new McpServer({ name: 'fake-door', version: '0.0.0' });
    server.registerTool('door_status', {
      description: 'status',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => {
      world.calls.push({ name: 'door_status' });
      return { content: [{ type: 'text', text: world.status }] };
    });
    server.registerTool('read_room', {
      description: 'read',
      inputSchema: { room: z.string().optional(), since: z.number().optional() },
      annotations: { readOnlyHint: true },
    }, async ({ room, since }) => {
      world.calls.push({ name: 'read_room', room, since });
      const text = typeof world.read === 'function' ? world.read({ room, since }) : world.read;
      return { content: [{ type: 'text', text }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"jsonrpc":"2.0","error":{"code":-32603,"message":"Internal error"},"id":null}');
      }
    }
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise((resolve) => httpServer.close(resolve)),
  };
}
