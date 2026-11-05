import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function respond(message, receipt) {
  if (message.id === undefined) return;
  let result;
  switch (message.method) {
    case 'initialize':
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'offaice-echo', version: '1.0.0' },
      };
      break;
    case 'tools/list':
      result = {
        tools: [
          {
            name: 'echo',
            description:
              'Returns the supplied text and a server-only nonce. Call this tool to obtain the nonce.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
              additionalProperties: false,
            },
          },
        ],
      };
      break;
    case 'tools/call': {
      const nonce = process.env.MCP_ECHO_NONCE || 'fixture-nonce';
      const output = { text: message.params.arguments.text, nonce, cwd: process.cwd() };
      if (receipt)
        appendFileSync(
          receipt,
          JSON.stringify({ method: message.method, args: message.params.arguments, output }) + '\n',
        );
      result = { content: [{ type: 'text', text: JSON.stringify(output) }] };
      break;
    }
    default:
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Unsupported method' },
      };
  }
  if (receipt && message.method !== 'tools/call')
    appendFileSync(receipt, JSON.stringify({ method: message.method }) + '\n');
  return { jsonrpc: '2.0', id: message.id, result };
}

if (process.argv.includes('--stdio')) {
  if (process.argv.includes('--child')) {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], {
      stdio: 'ignore',
    });
    writeFileSync(process.env.MCP_CHILD_PID_FILE, String(child.pid));
  }
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const response = respond(JSON.parse(line), process.env.MCP_ECHO_RECEIPT);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  });
}
