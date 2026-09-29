// Act as a visiting AI through a real door: node test/visit.mjs <file-holding-the-door-URL> <tool> [json-args]
// The URL is read from a file and never printed. Used for the live rehearsal (bead es-h13).
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const [urlFile, tool, raw] = process.argv.slice(2);
const url = fs.readFileSync(urlFile, 'utf8').trim();
const client = new Client({ name: 'seed-door-visit', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
if (tool === 'list') {
  const { tools } = await client.listTools();
  console.log(tools.map(t => `${t.name}${t.annotations?.readOnlyHint ? ' (read-only)' : ''}`).join('\n'));
} else {
  const args = raw ? JSON.parse(raw) : {};
  if (args.content_file) { args.content = fs.readFileSync(args.content_file, 'utf8'); delete args.content_file; }
  const r = await client.callTool({ name: tool, arguments: args });
  console.log((r.isError ? 'ERROR: ' : '') + r.content.map(c => c.text).join('\n'));
}
await client.close();
