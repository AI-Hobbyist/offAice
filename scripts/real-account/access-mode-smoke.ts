import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexAdapter } from '../../src/backend/adapters/codex';
import { ClaudeAdapter } from '../../src/backend/adapters/claude';
import { DshAdapter } from '../../src/backend/adapters/dsh';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import type { AdapterContext, Run, Session } from '../../src/shared/types';

const provider = process.argv.includes('--dsh')
  ? 'dsh'
  : process.argv.includes('--claude')
    ? 'claude'
    : 'codex';
const root = path.resolve('.test-cache', `access-${provider}-${Date.now()}`);
const home = path.join(root, 'home');
await mkdir(home, { recursive: true });
const native = path.join(
  os.homedir(),
  '.airoom',
  'data',
  'native',
  provider === 'codex' ? 'codex/home' : provider,
);
for (const file of provider === 'codex'
  ? ['auth.json']
  : provider === 'dsh'
    ? ['.credentials.yaml']
    : ['.credentials.json', '.claude.json'])
  await copyFile(path.join(native, file), path.join(home, file));
const deny = process.argv.includes('--deny');
for (const mode of (deny ? ['ask'] : ['ask', 'auto', 'full']) as ('ask' | 'auto' | 'full')[]) {
  const cwd = path.join(root, mode);
  await mkdir(cwd);
  const source = path.join(root, `input-${mode}.txt`),
    target = path.join(cwd, 'result.txt');
  const nonce = randomUUID();
  await writeFile(source, nonce);
  let approvals = 0;
  const adapter =
    provider === 'codex'
      ? new CodexAdapter()
      : provider === 'dsh'
        ? new DshAdapter()
        : new ClaudeAdapter();
  const ctx: AdapterContext = {
    accessMode: mode,
    conversation: 'room',
    roomProjectDirectory: cwd,
    run: { id: randomUUID(), provider, projectId: 'meeting' } as Run,
    session: {
      id: randomUUID(),
      provider,
      projectId: 'meeting',
      writeMode: true,
      autoApprove: mode === 'full',
    } as Session,
    cwd,
    env: {
      ...process.env,
      AIROOM_APP_ROOT: process.cwd(),
      AIROOM_NODE_EXE: process.execPath,
      AIROOM_CODEX_HOME: home,
      AIROOM_CODEX_STATE_DIR: path.join(root, 'sqlite'),
      AIROOM_CLAUDE_HOME: home,
      AIROOM_DSH_HOME: home,
    },
    settings: {
      ...DEFAULT_SETTINGS,
      paths: {},
      models: {},
      efforts: {},
      nodeRuntime: 'local',
      permissions: {
        ...DEFAULT_SETTINGS.permissions,
        [provider]: {
          commands: mode === 'ask' ? 'ask' : 'auto',
          fileScope: mode === 'full' ? 'any' : 'workspace',
          network: true,
        },
      },
    },
    emit(kind, text) {
      if (kind === 'error' || kind === 'warning') console.log(kind, text);
    },
    approve: async (request) => {
      approvals++;
      console.log(provider, mode, 'approval:', request.type, request.title);
      if (deny && request.type === 'approval') return { choice: request.denyChoice ?? 'deny' };
      if (request.type === 'question') {
        const questions = Array.isArray(request.questions) ? request.questions : [];
        return {
          choice: request.options.find((option) => /answer|accept/.test(option.id))?.id ?? 'answer',
          answers: Object.fromEntries(
            questions.map((question) => [
              question.id ?? question.question,
              question.options?.find((option) => /允许|allow|yes/i.test(option.label))?.label ??
                '允许执行上述读取和写入测试文件的操作。',
            ]),
          ),
        };
      }
      return {
        choice:
          request.allowChoice ??
          request.options.find((option) => /allow|accept/.test(option.id))?.id ??
          'deny',
      };
    },
    persistNativeSession() {},
    markDelivery() {},
    registerProcess() {},
  };
  const timer = setTimeout(() => void adapter.stop(), 120000);
  try {
    const result = await adapter.start(
      ctx,
      `Read the complete text of ${JSON.stringify(source)} using native file or command tools. Then write that exact text, with optional final newline, to ${JSON.stringify(target)} using native tools. Use real operations, request approval when required, do not ask in prose. Do not use MCP or alter any other files. Reply only DONE after the file exists.`,
    );
    if (deny) {
      await assert.rejects(access(target), { code: 'ENOENT' });
      assert.ok(approvals > 0);
      console.log(`${provider} ${mode}: denied operation left target absent PASS`);
      continue;
    }
    assert.ok(!result.failure && !result.unknown && !result.stopped, JSON.stringify(result));
    await access(target);
    assert.equal((await readFile(target, 'utf8')).trim(), nonce);
    if (mode === 'ask') assert.ok(approvals > 0, 'Request mode must ask before the write');
    console.log(
      `${provider} ${mode}: actual external read + file write PASS (${approvals} approval requests)`,
    );
  } finally {
    clearTimeout(timer);
    await adapter.dispose();
  }
}
console.log('Receipt:', root);
