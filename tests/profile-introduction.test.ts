import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Engine } from '../src/backend/engine';
import { personaInstructions } from '../src/shared/defaults';

test('profile introduction persists, supplements the unchanged card and can be removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airoom-profile-'));
  const engine = new Engine(
    root,
    () => {},
    () => {},
    undefined,
    { maintenanceOnly: true },
  );
  const card = {
    id: 'codex',
    executor: 'codex' as const,
    name: '角色',
    persona: '角色卡原文 CARD_MARKER',
    userTitle: '主人',
  };
  const original = structuredClone(card);
  try {
    assert.equal(engine.store.profile().introduction, undefined);
    await engine.invoke('profile.save', {
      profile: { name: '测试用户', introduction: '  我从事开发，偏好中文。PROFILE_MARKER  ' },
    });
    const profile = engine.store.profile();
    assert.equal(profile.introduction, '我从事开发，偏好中文。PROFILE_MARKER');
    const context = personaInstructions(card, profile);
    assert.ok(context.includes('PROFILE_MARKER'));
    assert.ok(context.includes(card.persona));
    assert.ok(context.includes('称呼用户为「主人」'));
    assert.deepEqual(card, original);
    await engine.invoke('profile.save', { profile: { name: '新名字' } });
    assert.equal(engine.store.profile().introduction, profile.introduction);
    await assert.rejects(
      engine.invoke('profile.save', {
        profile: { name: '新名字', introduction: 'x'.repeat(8001) },
      }),
      /8000/,
    );
    assert.equal(engine.store.profile().introduction, profile.introduction);
    await engine.invoke('profile.save', { profile: { name: '新名字', introduction: '' } });
    assert.equal(engine.store.profile().introduction, undefined);
    assert.ok(!personaInstructions(card, engine.store.profile()).includes('PROFILE_MARKER'));
  } finally {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
});
