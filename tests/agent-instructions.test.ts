import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  instructionInput,
  loadAgentInstructions,
  prepareAgentInstructions,
} from '../src/backend/agent-instructions';
import { latestPersona } from '../src/backend/native-context';
import { runtimeFingerprint } from '../src/backend/runtime-pool';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import type { AdapterContext } from '../src/shared/types';

test('global and project AGENTS supplement the unchanged role card and remain project-isolated', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'offaice-agents-'));
  const project = path.join(root, 'project'),
    other = path.join(root, 'other');
  await Promise.all([mkdir(path.join(root, '.airoom')), mkdir(project), mkdir(other)]);
  try {
    assert.equal(await loadAgentInstructions(project, root), '');
    await writeFile(
      path.join(root, '.airoom', 'AGENTS.md'),
      '\uFEFF全局约定 GLOBAL_MARKER',
      'utf8',
    );
    await writeFile(path.join(project, 'AGENTS.md'), '项目约定 PROJECT_MARKER', 'utf8');
    const persona = '角色卡：称呼为阿晴，保留角色记忆。';
    const ctx = {
      persona,
      cwd: project,
      env: {},
      run: { provider: 'codex' },
      session: { writeMode: false },
      settings: DEFAULT_SETTINGS,
      freshInput: () => '重建的消息',
      refreshInput: () => '刷新的消息',
    } as unknown as AdapterContext;
    await prepareAgentInstructions(ctx, project, root);
    assert.equal(ctx.persona, persona);
    assert.ok(
      ctx.agentInstructions!.indexOf('GLOBAL_MARKER') <
        ctx.agentInstructions!.indexOf('PROJECT_MARKER'),
    );
    assert.match(ctx.agentInstructions!, /角色卡提示词完整保留并优先于 AGENTS/);
    assert.match(instructionInput(ctx, '用户消息'), /PROJECT_MARKER[\s\S]*用户消息/);
    assert.match(ctx.freshInput!(true), /GLOBAL_MARKER[\s\S]*重建的消息/);
    assert.match(ctx.refreshInput!(), /PROJECT_MARKER[\s\S]*刷新的消息/);
    assert.match(latestPersona(persona), /角色卡提示词完整保留并优先于 AGENTS/);
    assert.ok(latestPersona(persona).endsWith(persona));
    assert.ok(!(await loadAgentInstructions(other, root)).includes('PROJECT_MARKER'));
    const before = runtimeFingerprint(ctx);
    await writeFile(path.join(project, 'AGENTS.md'), '变更后的项目约定');
    ctx.agentInstructions = await loadAgentInstructions(project, root);
    assert.notEqual(runtimeFingerprint(ctx), before);
    assert.equal(ctx.persona, persona);
    ctx.agentInstructions = '';
    assert.match(instructionInput(ctx, '新消息'), /不沿用此前 AGENTS 条款/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unreadable AGENTS is reported instead of silently dropping requested instructions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'offaice-agents-error-'));
  try {
    await mkdir(path.join(root, 'AGENTS.md'));
    await assert.rejects(loadAgentInstructions(root, root), /无法读取工作约定/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
