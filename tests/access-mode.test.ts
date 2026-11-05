import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Engine } from '../src/backend/engine';
import { codexSessionPolicy } from '../src/backend/adapters/codex';
import { plainRoomSpeech, roomProjectFiles } from '../src/backend/adapters/chat-policy';
import {
  describeAttachments,
  importAttachments,
  resolveAttachments,
} from '../src/backend/attachments';
import { runtimeFingerprint } from '../src/backend/runtime-pool';
import type { Project, Run, Session } from '../src/shared/types';

test('meeting and desk access modes persist per topic and reach native policies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airoom-access-'));
  const engine = new Engine(
    root,
    () => {},
    () => {},
    undefined,
    { maintenanceOnly: true },
  );
  try {
    const project = (await engine.invoke('project.create', {
      name: 'access',
      directory: root,
    })) as Project;
    const roomId = `project:${project.id}` as const;
    const thread = engine.store.currentRoomThread(roomId);
    engine.store.put('projects', 'internal', {
      id: 'internal',
      kind: 'lounge',
      roomId,
      directory: root,
    });
    const session = engine.createSession('internal', 'codex', 'meeting', false);
    session.roomThreadId = thread.id;
    const run = {
      id: 'access-run',
      projectId: session.projectId,
      sessionId: session.id,
      provider: 'codex',
      requestedConfig: {},
    } as Run;
    const inherited = engine['context'](run, session);
    await assert.rejects(engine.invoke('room.access.save', { roomId, mode: 'full' }), /确认/);
    const stamps = new Set<string>();
    for (const mode of ['ask', 'auto', 'full'] as const) {
      await engine.invoke('room.access.save', { roomId, mode, confirm: true });
      const ctx = engine['context'](run, session);
      assert.equal(ctx.accessMode, mode);
      assert.equal(ctx.session.writeMode, true);
      assert.equal(ctx.cwd, root);
      assert.equal(plainRoomSpeech(ctx), false);
      assert.equal(roomProjectFiles(ctx), undefined);
      assert.equal(
        engine.store.get<Session>('sessions', session.id)?.writeMode,
        false,
        'native permissions must not reclassify a meeting as a flow write task',
      );
      const policy = codexSessionPolicy(
        ctx.settings.permissions.codex,
        ctx.session.writeMode,
        ctx.session.autoApprove,
        mode,
      );
      assert.equal(
        policy.sandbox,
        mode === 'ask' ? 'read-only' : mode === 'auto' ? 'workspace-write' : 'danger-full-access',
      );
      assert.equal(
        policy.approvalPolicy,
        mode === 'full' ? 'never' : mode === 'auto' ? 'on-request' : 'untrusted',
      );
      assert.equal(policy.declineCommands, false);
      stamps.add(runtimeFingerprint(ctx));
    }
    assert.equal(stamps.size, 3);
    const full = engine['context'](run, session);
    engine['active'].set(run.id, { ctx: full, stopping: false } as any);
    try {
      const reply = await full.approve({
        type: 'approval',
        title: 'test file write',
        detail: 'isolated fixture',
        options: [
          { id: 'allow', label: '允许这次' },
          { id: 'deny', label: '拒绝' },
        ],
        allowChoice: 'allow',
        denyChoice: 'deny',
        category: 'file',
      });
      assert.equal(reply.choice, 'allow');
      assert.ok(
        engine.store
          .list<{ autoApproved?: string }>('approvals')
          .some((record) => record.autoApproved),
      );
    } finally {
      engine['active'].delete(run.id);
    }
    assert.equal(inherited.session.writeMode, false);
    const member = (await engine.invoke('team.save', {
      member: { executor: 'codex', name: 'desk' },
    })) as { id: string };
    const deskId = `desk:${member.id}` as const;
    await engine.invoke('desk.switchFolder', { memberId: member.id, directory: root });
    const topic = (await engine.invoke('desk.topic', { memberId: member.id })) as { id: string };
    const deskTopic = engine.store.get<{ sessionId: string }>('desk_topics', topic.id)!;
    const deskSession = engine.store.get<Session>('sessions', deskTopic.sessionId)!;
    const desk = (await engine.invoke('desk.open', { memberId: member.id })) as {
      currentThreadId: string;
    };
    await engine.invoke('room.access.save', { roomId: deskId, mode: 'ask', confirm: true });
    const deskRun = { ...run, projectId: project.id, sessionId: deskSession.id };
    assert.equal(engine['context'](deskRun, deskSession).accessMode, 'ask');
    assert.ok(desk.currentThreadId);
  } finally {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('long room attachments carry their stored readable path instead of claiming they cannot be opened', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airoom-long-file-'));
  try {
    const source = path.join(root, 'crash.txt');
    await writeFile(source, 'stack trace\n'.repeat(3200));
    const files = resolveAttachments(root, importAttachments(root, [source]));
    const text = describeAttachments(files, { images: false, paths: true, source: 'room' });
    assert.ok(text.includes(files[0].path));
    assert.ok(!text.includes('无法打开'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
