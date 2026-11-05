import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexAdapter } from '../../src/backend/adapters/codex';
import { ClaudeAdapter } from '../../src/backend/adapters/claude';
import { DshAdapter } from '../../src/backend/adapters/dsh';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import type { AdapterContext, Adapter, Run, Session } from '../../src/shared/types';
import { respond } from '../../tests/fixtures/mcp-echo.mjs';

const provider = process.argv.includes('--dsh')
  ? 'dsh'
  : process.argv.includes('--claude')
    ? 'claude'
    : 'codex';
const directory = path.resolve('.test-cache', `mcp-${provider}-${Date.now()}`);
await mkdir(directory, { recursive: true });
const receipts: unknown[] = [];
const server = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405);
    response.end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  const packet = JSON.parse(body);
  if (packet.method === 'tools/call') receipts.push(packet.params);
  const reply = respond(packet);
  if (!reply) {
    response.writeHead(202);
    response.end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(reply));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const home = path.join(os.homedir(), '.airoom', 'data', 'native');
const settings = {
  ...DEFAULT_SETTINGS,
  models: {},
  efforts: {},
  paths: {},
  nodeRuntime: 'local' as const,
  permissions: {
    ...DEFAULT_SETTINGS.permissions,
    [provider]: { commands: 'auto' as const, network: true, fileScope: 'any' as const },
  },
};
const env = {
  ...process.env,
  AIROOM_APP_ROOT: process.cwd(),
  AIROOM_NODE_EXE: process.execPath,
  AIROOM_LOCAL_NODE_EXE: process.execPath,
  AIROOM_CODEX_HOME: path.join(home, 'codex', 'home'),
  AIROOM_CODEX_STATE_DIR: path.join(directory, 'sqlite'),
  AIROOM_CLAUDE_HOME: path.join(home, 'claude'),
  AIROOM_DSH_HOME: path.join(home, 'dsh'),
};
try {
  for (const transport of ['stdio', 'http'] as const) {
    const nonce = randomUUID();
    const receipt = path.join(directory, `${transport}.jsonl`);
    let output = '';
    const adapter: Adapter =
      provider === 'dsh'
        ? new DshAdapter()
        : provider === 'claude'
          ? new ClaudeAdapter()
          : new CodexAdapter();
    const ctx: AdapterContext = {
      run: { id: randomUUID(), provider, projectId: 'mcp-smoke', input: '', revision: 1 } as Run,
      session: {
        id: randomUUID(),
        projectId: 'mcp-smoke',
        provider,
        writeMode: true,
        autoApprove: false,
      } as Session,
      cwd: directory,
      env,
      settings,
      mcp: [
        {
          scope: { scope: 'global' },
          source: 'app',
          layer: 'override',
          server:
            transport === 'stdio'
              ? {
                  name: 'echotest',
                  enabled: true,
                  transport,
                  command: process.execPath,
                  args: [path.resolve('tests/fixtures/mcp-echo.mjs'), '--stdio'],
                  env: { MCP_ECHO_NONCE: nonce, MCP_ECHO_RECEIPT: receipt },
                }
              : { name: 'echotest', enabled: true, transport, url: `http://127.0.0.1:${port}/mcp` },
        },
      ],
      emit(kind, text) {
        if (kind === 'delta' || kind === 'message') output += text;
        if (kind === 'error' || kind === 'warning') console.log(kind, text);
      },
      approve: async (request) => ({
        choice:
          request.allowChoice ??
          request.options.find((option) => /allow|accept/.test(option.id))?.id ??
          'deny',
      }),
      persistNativeSession(id) {
        ctx.session.nativeId = id;
        ctx.session.nativeHome = 'airoom';
      },
      markDelivery() {},
      registerProcess() {},
    };
    const timeout = setTimeout(() => {
      void adapter.stop();
    }, 120000);
    try {
      const marker = `${transport}-actual-${Date.now()}`;
      const result = await adapter.start(
        ctx,
        `Call the echotest MCP echo tool exactly once with text "${marker}". Do not use shell or other tools. Reply with the returned text and nonce verbatim.`,
      );
      assert.ok(!result.stopped && !result.failure && !result.unknown, JSON.stringify(result));
      if (transport === 'stdio') {
        const rows = (await readFile(receipt, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        assert.ok(rows.some((row) => row.method === 'tools/call' && row.args.text === marker));
        assert.ok(output.includes(nonce), 'Model did not return the server-only nonce');
      } else {
        assert.ok(receipts.some((value: any) => value.arguments?.text === marker));
        assert.ok(output.includes('fixture-nonce'));
      }
      assert.ok(output.includes(marker));
      console.log(`${provider} ${transport}: model -> MCP -> model PASS`);
      if (process.argv.includes('--resume')) {
        const resumedMarker = marker + '-resumed';
        output = '';
        const resumed = await adapter.start(
          ctx,
          `Call echotest echo exactly once with text "${resumedMarker}". Reply with its returned text and nonce.`,
        );
        assert.ok(
          !resumed.stopped && !resumed.failure && !resumed.unknown,
          JSON.stringify(resumed),
        );
        assert.ok(output.includes(resumedMarker));
        if (transport === 'stdio') {
          const rows = (await readFile(receipt, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          assert.ok(
            rows.some((row) => row.method === 'tools/call' && row.args.text === resumedMarker),
          );
          assert.ok(output.includes(nonce));
        } else assert.ok(receipts.some((value: any) => value.arguments?.text === resumedMarker));
        console.log(`${provider} ${transport}: resumed model -> MCP -> model PASS`);
      }
    } finally {
      clearTimeout(timeout);
      await adapter.dispose?.();
      await adapter.stop();
    }
  }
  await writeFile(
    path.join(directory, 'receipt.json'),
    JSON.stringify({ provider, stdio: 'passed', http: 'passed', at: new Date().toISOString() }),
  );
  console.log(`Receipt: ${directory}`);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
