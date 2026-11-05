import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const meeting = process.argv.includes('--meeting');
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
    [provider]: {
      commands: meeting ? ('deny' as const) : ('auto' as const),
      network: true,
      fileScope: meeting ? ('workspace' as const) : ('any' as const),
    },
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
// Meeting tests use a separate native home; never modify the running desktop's sessions/configuration.
if (meeting && provider !== 'dsh') {
  const isolatedHome = path.join(directory, 'native-home');
  await mkdir(isolatedHome, { recursive: true });
  const source = provider === 'codex' ? env.AIROOM_CODEX_HOME : env.AIROOM_CLAUDE_HOME;
  for (const file of provider === 'codex' ? ['auth.json'] : ['.credentials.json', '.claude.json'])
    await copyFile(path.join(source, file), path.join(isolatedHome, file));
  if (provider === 'codex') env.AIROOM_CODEX_HOME = isolatedHome;
  else env.AIROOM_CLAUDE_HOME = isolatedHome;
}
try {
  for (const transport of (process.argv.includes('--stdio-only')
    ? ['stdio']
    : ['stdio', 'http']) as ('stdio' | 'http')[]) {
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
        writeMode: !meeting,
        autoApprove: false,
      } as Session,
      cwd: directory,
      roomRuntime: process.argv.includes('--disable'),
      conversation: meeting ? 'room' : process.argv.includes('--disable') ? 'desk' : undefined,
      roomMcpEnabled: meeting,
      roomProjectDirectory: meeting ? directory : undefined,
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
      persistNativeMcpServers(names) {
        ctx.session.nativeMcpServerNames = names;
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
      if (process.argv.includes('--disable') && provider === 'codex') {
        ctx.mcp = [];
        output = '';
        const disabledMarker = 'MCP_DISABLED_' + randomUUID();
        const disabled = await adapter.start(
          ctx,
          `If echotest echo is available call it with text "unexpected-call". Otherwise reply only ${disabledMarker}. Do not use any other tools.`,
        );
        assert.ok(!disabled.stopped && !disabled.unknown && !disabled.failure);
        const rpc = Reflect.get(adapter, 'rpc');
        assert.ok(rpc, 'The real runtime was not retained for inventory verification');
        const inventory = await rpc.request('mcpServerStatus/list', {
          threadId: ctx.session.nativeId,
        });
        console.log(
          JSON.stringify({
            managedNames: ctx.session.nativeMcpServerNames,
            inventory: inventory.data.map((server: any) => ({
              name: server.name,
              status: server.runtimeStatus,
              tools: Object.keys(server.tools ?? {}).length,
            })),
          }),
        );
        assert.ok(
          inventory.data.every((server: any) => Object.keys(server.tools ?? {}).length === 0),
        );
        assert.ok(output.includes(disabledMarker));
        console.log(
          `${provider} ${transport}: changed configuration removed old native tools PASS`,
        );
      }
    } finally {
      clearTimeout(timeout);
      await adapter.dispose?.();
      await adapter.stop();
    }
  }
  await writeFile(
    path.join(directory, 'receipt.json'),
    JSON.stringify({
      provider,
      stdio: 'passed',
      http: process.argv.includes('--stdio-only') ? 'not-run' : 'passed',
      at: new Date().toISOString(),
    }),
  );
  console.log(`Receipt: ${directory}`);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
