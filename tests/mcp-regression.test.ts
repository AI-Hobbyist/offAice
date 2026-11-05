import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readMcpSource } from '../src/backend/mcp/sources';
import { McpService } from '../src/backend/mcp/service';
import { Store } from '../src/backend/store';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import { runtimeFingerprint, RoomRuntimePool } from '../src/backend/runtime-pool';
import type { Adapter, AdapterContext } from '../src/shared/types';

test('duplicate source keys and invalid JSON roots cannot be silently imported', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'offaice-mcp-duplicates-'));
  const file = path.join(root, 'mcp.json');
  try {
    await writeFile(file, '{"mcpServers":{"echo":{"command":"one"},"echo":{"command":"two"}}}');
    const duplicate = await readMcpSource(
      { source: 'file', file, format: 'json' },
      { scope: 'global' },
    );
    assert.match(duplicate.issues[0], /重复配置键名：echo/);
    assert.deepEqual(duplicate.entries, []);
    await writeFile(file, 'null');
    const invalid = await readMcpSource(
      { source: 'file', file, format: 'json' },
      { scope: 'global' },
    );
    assert.match(invalid.issues[0], /根节点必须是对象/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project trust is explicit and configuration/credential changes invalidate the runtime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'offaice-mcp-trust-'));
  const store = new Store(root),
    service = new McpService(store);
  let approvals = 0,
    disposed = 0;
  const ctx = {
    run: { provider: 'codex', projectId: 'p' },
    session: { writeMode: true },
    cwd: root,
    env: {},
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
          name: 'echo',
          transport: 'http',
          enabled: true,
          url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer original' },
        },
      },
    ],
    emit() {},
    approve: async (request: any) => {
      assert.equal(request.type, 'question');
      approvals++;
      return { choice: 'allow' };
    },
  } as unknown as AdapterContext;
  const pool = new RoomRuntimePool();
  const adapter = () =>
    ({
      canReuse: () => true,
      dispose: async () => {
        disposed++;
      },
    }) as unknown as Adapter;
  try {
    await service.prepare(ctx);
    await service.prepare(ctx);
    assert.equal(approvals, 1);
    const before = runtimeFingerprint(ctx);
    const lease = await pool.acquire('session', before, adapter);
    await lease.release(true);
    ctx.mcp![0].server.headers!.Authorization = 'Bearer changed';
    assert.notEqual(runtimeFingerprint(ctx), before);
    const replaced = await pool.acquire('session', runtimeFingerprint(ctx), adapter);
    assert.equal(replaced.reused, false);
    assert.equal(disposed, 1);
    await replaced.release(false);
    await service.prepare(ctx);
    assert.equal(approvals, 2);
    ctx.session.writeMode = false;
    await service.prepare(ctx);
    assert.equal(approvals, 2);
    await assert.rejects(service.test({ scope: 'global', name: 'echo' }, {}), /请先确认/);
  } finally {
    await pool.invalidate();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
