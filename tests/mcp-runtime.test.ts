import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { connectMcp } from '../src/backend/mcp/client';
import {
  acpMcpServers,
  claudeMcpServers,
  codexMcpConfig,
  mcpRestriction,
} from '../src/backend/mcp/execution';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import type { AdapterContext } from '../src/shared/types';
import { respond } from './fixtures/mcp-echo.mjs';
import { nativeStdio } from '../src/backend/mcp/launch';
import { setTimeout as delay } from 'node:timers/promises';

function context(): AdapterContext {
  return {
    run: { provider: 'codex' },
    session: { writeMode: true },
    cwd: process.cwd(),
    settings: {
      ...DEFAULT_SETTINGS,
      permissions: {
        ...DEFAULT_SETTINGS.permissions,
        codex: { commands: 'auto', fileScope: 'any', network: true },
      },
    },
    mcp: [
      {
        scope: { scope: 'global' },
        source: 'app',
        layer: 'override',
        server: {
          name: 'echo',
          enabled: true,
          transport: 'http',
          url: 'http://127.0.0.1:1234/mcp',
        },
      },
    ],
  } as AdapterContext;
}

test('native mappings preserve transports, disable inherited servers and enforce capability/permission boundaries', () => {
  const ctx = context();
  assert.equal((claudeMcpServers(ctx).echo as any).type, 'http');
  assert.throws(() => acpMcpServers(ctx, {}), /HTTP MCP/);
  assert.equal((acpMcpServers(ctx, { mcpCapabilities: { http: true } })[0] as any).type, 'http');
  const config = codexMcpConfig(ctx, { old: { command: 'do-not-run' } }) as any;
  assert.equal(config.mcp_servers.old.enabled, false);
  const managedName = Object.keys(config.mcp_servers).find((name) =>
    name.startsWith('offaice_echo_'),
  )!;
  assert.equal(config.mcp_servers[managedName].enabled, true);
  ctx.session.nativeMcpServerNames = [managedName];
  ctx.mcp = [];
  assert.equal((codexMcpConfig(ctx, {}) as any).mcp_servers[managedName].enabled, false);
  for (const scenario of ['readonly', 'network', 'commands', 'workspace', 'room']) {
    const item = context();
    if (scenario === 'readonly') item.session.writeMode = false;
    if (scenario === 'network') item.settings.permissions.codex.network = false;
    if (scenario === 'commands') item.settings.permissions.codex.commands = 'deny';
    if (scenario === 'workspace') item.settings.permissions.codex.fileScope = 'workspace';
    if (scenario === 'room') item.conversation = 'room';
    assert.ok(mcpRestriction(item));
    assert.deepEqual(claudeMcpServers(item), {});
    assert.deepEqual(acpMcpServers(item, {}), []);
  }
});

test('SDK stdio initializes, discovers and calls a real child server, then closes its guardian', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'offaice-mcp-runtime-'));
  const receipt = path.join(directory, 'receipt.jsonl');
  let pid: number | null | undefined;
  try {
    const connection = await connectMcp(
      {
        name: 'echo',
        enabled: true,
        transport: 'stdio',
        command: process.execPath,
        args: [path.resolve('tests/fixtures/mcp-echo.mjs'), '--stdio'],
        env: { MCP_ECHO_RECEIPT: receipt },
      },
      directory,
      process.env,
    );
    pid = connection.pid;
    try {
      assert.equal((await connection.client.listTools()).tools[0].name, 'echo');
      const result = await connection.client.callTool({
        name: 'echo',
        arguments: { text: 'actual-stdio-call' },
      });
      assert.match(JSON.stringify(result), /actual-stdio-call/);
    } finally {
      await connection.close();
    }
    const rows = (await readFile(receipt, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      rows.map((row) => row.method),
      ['initialize', 'tools/list', 'tools/call'],
    );
    assert.equal(rows[2].args.text, 'actual-stdio-call');
    if (pid) assert.throws(() => process.kill(pid!, 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('native stdio cwd helper runs the actual server in the selected directory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'offaice-mcp-cwd-'));
  const ctx = context();
  ctx.env = { ...process.env, AIROOM_NODE_EXE: process.execPath, AIROOM_APP_ROOT: process.cwd() };
  const launch = nativeStdio(
    {
      name: 'echo',
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: [path.resolve('tests/fixtures/mcp-echo.mjs'), '--stdio'],
      cwd: directory,
    },
    ctx,
  );
  const connection = await connectMcp(
    { ...launch, name: 'echo', enabled: true, transport: 'stdio' },
    process.cwd(),
    ctx.env,
  );
  try {
    const result = await connection.client.callTool({
      name: 'echo',
      arguments: { text: 'cwd-check' },
    });
    const text = result.content.find((item) => item.type === 'text');
    assert.ok(text?.type === 'text');
    assert.equal(JSON.parse(text.text).cwd, directory);
  } finally {
    await connection.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('stdio startup failures, cancellation and descendant cleanup use real processes', async () => {
  await assert.rejects(
    connectMcp(
      {
        name: 'missing',
        transport: 'stdio',
        enabled: true,
        command: path.resolve('.test-cache/does-not-exist.exe'),
      },
      process.cwd(),
      process.env,
    ),
    /找不到/,
  );
  await assert.rejects(
    connectMcp(
      {
        name: 'exit',
        transport: 'stdio',
        enabled: true,
        command: process.execPath,
        args: ['-e', 'process.exit(1)'],
        startupTimeoutMs: 500,
      },
      process.cwd(),
      process.env,
    ),
  );
  const controller = new AbortController();
  const pending = connectMcp(
    {
      name: 'hang',
      transport: 'stdio',
      enabled: true,
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      startupTimeoutMs: 5000,
    },
    process.cwd(),
    process.env,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'offaice-mcp-child-'));
  try {
    const file = path.join(directory, 'pid.txt');
    const connection = await connectMcp(
      {
        name: 'tree',
        enabled: true,
        transport: 'stdio',
        command: process.execPath,
        args: [path.resolve('tests/fixtures/mcp-echo.mjs'), '--stdio', '--child'],
        env: { MCP_CHILD_PID_FILE: file },
      },
      directory,
      process.env,
    );
    const pid = Number(await readFile(file, 'utf8'));
    await connection.close();
    let alive = true;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
        break;
      }
      await delay(25);
    }
    assert.equal(alive, false, 'MCP descendant survived connection shutdown');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SDK HTTP handles JSON and SSE results plus authentication and startup timeout failures', async () => {
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/auth') {
      response.writeHead(401);
      response.end();
      return;
    }
    if (request.url === '/forbidden') {
      response.writeHead(403);
      response.end();
      return;
    }
    if (request.url === '/slow') return;
    if (request.method !== 'POST') {
      response.writeHead(405);
      response.end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const packet = JSON.parse(body);
    calls.push(packet.method);
    const result = respond(packet);
    if (!result) {
      response.writeHead(202);
      response.end();
      return;
    }
    if (request.url === '/sse') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const route of ['/json', '/sse']) {
      const connection = await connectMcp(
        { name: 'echo', enabled: true, transport: 'http', url: url + route },
        process.cwd(),
        process.env,
      );
      try {
        assert.equal((await connection.client.listTools()).tools[0].name, 'echo');
        assert.match(
          JSON.stringify(
            await connection.client.callTool({ name: 'echo', arguments: { text: route } }),
          ),
          /fixture-nonce/,
        );
      } finally {
        await connection.close();
      }
    }
    await assert.rejects(
      connectMcp(
        { name: 'echo', enabled: true, transport: 'http', url: url + '/auth' },
        process.cwd(),
        process.env,
      ),
      /401|Unauthorized/,
    );
    await assert.rejects(
      connectMcp(
        { name: 'echo', enabled: true, transport: 'http', url: url + '/forbidden' },
        process.cwd(),
        process.env,
      ),
      /403/,
    );
    await assert.rejects(
      connectMcp(
        {
          name: 'echo',
          enabled: true,
          transport: 'http',
          url: url + '/slow',
          startupTimeoutMs: 200,
        },
        process.cwd(),
        process.env,
      ),
      /timeout|timed out/i,
    );
    assert.equal(calls.filter((method) => method === 'tools/call').length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
