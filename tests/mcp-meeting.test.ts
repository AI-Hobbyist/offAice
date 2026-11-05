import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Engine } from '../src/backend/engine';
import {
  executableServers,
  mcpRestriction,
  codexMcpConfig,
  claudeMcpServers,
  acpMcpServers,
} from '../src/backend/mcp/execution';
import { connectMcp } from '../src/backend/mcp/client';
import { runtimeFingerprint } from '../src/backend/runtime-pool';
import type { Project, Run, RoomThread } from '../src/shared/types';

test('project meeting explicitly authorizes bound project MCP without enabling native writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airoom-meeting-mcp-'));
  const engine = new Engine(
    root,
    () => {},
    () => {},
    undefined,
    { maintenanceOnly: true },
  );
  try {
    engine.mcp.setKey(Buffer.alloc(32, 7).toString('base64'));
    const project = (await engine.invoke('project.create', {
      name: 'meeting',
      directory: root,
    })) as Project;
    const roomId = `project:${project.id}` as const;
    const thread = engine.store.currentRoomThread(roomId);
    engine.store.put('projects', 'meeting-internal', {
      id: 'meeting-internal',
      kind: 'lounge',
      roomId,
      directory: root,
    });
    const session = engine.createSession('meeting-internal', 'codex', 'meeting', false);
    session.roomThreadId = thread.id;
    const run = {
      id: 'meeting-run',
      projectId: session.projectId,
      sessionId: session.id,
      provider: 'codex',
      requestedConfig: {},
    } as Run;
    const server = {
      name: 'echo',
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: [path.resolve('tests/fixtures/mcp-echo.mjs'), '--stdio'],
    };
    await engine.mcp.invoke('mcp.save', { scope: 'global', server: { ...server, enabled: false } });
    await engine.mcp.invoke('mcp.save', { scope: 'project', projectId: project.id, server });
    const before = engine['context'](run, session);
    assert.equal(before.mcp?.[0].server.enabled, true, 'bound project override must win');
    assert.equal(executableServers(before).length, 0);
    await assert.rejects(engine.invoke('room.mcp.save', { roomId, enabled: true }), /确认/);
    await engine.invoke('room.mcp.save', { roomId, enabled: true, confirm: true });
    const enabled = engine['context'](run, session);
    assert.equal(enabled.roomMcpEnabled, true);
    assert.equal(enabled.session.writeMode, false);
    assert.equal(enabled.settings.permissions.codex.commands, 'deny');
    assert.equal(enabled.settings.permissions.codex.fileScope, 'workspace');
    assert.equal(mcpRestriction(enabled), undefined);
    assert.equal(executableServers(enabled).length, 1);
    assert.notEqual(runtimeFingerprint(before), runtimeFingerprint(enabled));
    assert.equal(Object.keys(claudeMcpServers(enabled)).length, 1);
    assert.equal(acpMcpServers(enabled, {}).length, 1);
    assert.equal(Object.values(codexMcpConfig(enabled, {}).mcp_servers).length, 1);
    const launch = claudeMcpServers(enabled).echo as {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    const connection = await connectMcp(
      { ...server, ...launch, transport: 'stdio' },
      root,
      process.env,
    );
    try {
      assert.match(
        JSON.stringify(
          await connection.client.callTool({
            name: 'echo',
            arguments: { text: 'meeting-real-call' },
          }),
        ),
        /meeting-real-call/,
      );
    } finally {
      await connection.close();
    }
    enabled.settings.permissions.codex.network = false;
    assert.match(mcpRestriction(enabled)!, /禁止联网/);
    for (const purpose of ['room-hand', 'room-minutes', 'room-image'] as const) {
      const auxiliary = engine['context'](run, { ...session, purpose });
      assert.equal(auxiliary.roomMcpEnabled, false);
      assert.equal(executableServers(auxiliary).length, 0);
    }
    await engine.invoke('room.mcp.save', { roomId, enabled: false });
    const revoked = engine['context'](run, session);
    assert.equal(executableServers(revoked).length, 0);
    assert.equal(engine.store.get<RoomThread>('room_threads', thread.id)?.mcpEnabled, false);
    await assert.rejects(
      engine.invoke('room.mcp.save', { enabled: true, confirm: true }),
      /仅项目/,
    );
  } finally {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
});
