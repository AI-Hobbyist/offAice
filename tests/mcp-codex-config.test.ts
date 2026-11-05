import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnOwned, stopOwned } from '../src/backend/process-supervisor';
import { JsonLineRpc } from '../src/backend/adapters/common';
import { codexMcpConfig } from '../src/backend/mcp/execution';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import type { AdapterContext } from '../src/shared/types';

test(
  'installed Codex app-server disables inherited MCP before thread tool discovery',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'offaice-mcp-codex-'));
    const receipt = path.join(directory, 'unwanted.jsonl');
    const command = process.execPath.replaceAll('\\', '/');
    const fixture = path.resolve('tests/fixtures/mcp-echo.mjs').replaceAll('\\', '/');
    await writeFile(
      path.join(directory, 'config.toml'),
      `[mcp_servers.unwanted]\ncommand = ${JSON.stringify(command)}\nargs = [${JSON.stringify(fixture)}, "--stdio"]\n[mcp_servers.unwanted.env]\nMCP_ECHO_RECEIPT = ${JSON.stringify(receipt.replaceAll('\\', '/'))}\n`,
    );
    const child = spawnOwned(
      process.execPath,
      [path.resolve('node_modules/@openai/codex/bin/codex.js'), 'app-server'],
      { cwd: directory, env: { ...process.env, CODEX_HOME: directory } },
    );
    const rpc = new JsonLineRpc(child);
    child.stderr?.on('data', () => {});
    try {
      await rpc.request('initialize', { clientInfo: { name: 'offaice-test', version: '1.0.0' } });
      rpc.notify('initialized');
      const read = await rpc.request('config/read', { includeLayers: false });
      assert.ok(read.config.mcp_servers.unwanted);
      const started = await rpc.request('thread/start', {
        cwd: directory,
        ephemeral: true,
        config: { mcp_servers: { unwanted: { enabled: false } } },
      });
      const status = await rpc.request('mcpServerStatus/list', { threadId: started.thread.id });
      assert.equal(status.data[0].runtimeStatus, 'disabled');
      assert.ok(status.data.every((server: any) => Object.keys(server.tools ?? {}).length === 0));
      await assert.rejects(readFile(receipt, 'utf8'), { code: 'ENOENT' });
      const ctx = {
        cwd: directory,
        run: { provider: 'codex' },
        session: { writeMode: true },
        emit() {},
        settings: {
          ...DEFAULT_SETTINGS,
          permissions: {
            ...DEFAULT_SETTINGS.permissions,
            codex: { commands: 'auto', network: true, fileScope: 'any' },
          },
        },
        mcp: [
          {
            server: {
              name: 'unwanted',
              command,
              args: [fixture, '--stdio'],
              env: {},
              transport: 'stdio',
              enabled: true,
            },
          },
        ],
      } as unknown as AdapterContext;
      const replacement = await rpc.request('thread/start', {
        cwd: directory,
        ephemeral: true,
        config: codexMcpConfig(ctx, read.config.mcp_servers),
      });
      const replaced = await rpc.request('mcpServerStatus/list', {
        threadId: replacement.thread.id,
      });
      assert.ok(
        replaced.data.some((entry: any) => entry.name.startsWith('offaice_') && entry.tools.echo),
      );
      await assert.rejects(readFile(receipt, 'utf8'), { code: 'ENOENT' });
    } finally {
      rpc.close();
      await stopOwned(child, 2000);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
