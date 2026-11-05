import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nativeStdio } from '../src/backend/mcp/launch';
import { resolveMcpCommand } from '../src/backend/mcp/command';

test('MCP command names resolve Node forwarding shims and preserve their runtime flags', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airoom-mcp-command-'));
  const bin = path.join(root, 'bin');
  const script = path.join(root, 'lib', 'dist', 'bin', 'codegraph.js');
  try {
    await mkdir(path.dirname(script), { recursive: true });
    await mkdir(bin);
    await writeFile(path.join(root, 'node.exe'), 'fixture');
    await writeFile(script, '// fixture');
    await writeFile(
      path.join(bin, 'codegraph.cmd'),
      '@"%~dp0..\\node.exe" --liftoff-only "%~dp0..\\lib\\dist\\bin\\codegraph.js" %*\r\n',
    );
    const ctx = { cwd: root, env: { Path: bin, AIROOM_NODE_EXE: process.execPath } };
    const result = nativeStdio(
      {
        name: 'codegraph',
        enabled: true,
        transport: 'stdio',
        command: 'codegraph',
        args: ['serve', '--mcp'],
      },
      ctx,
    );
    assert.equal(result.command, path.join(root, 'node.exe'));
    assert.deepEqual(result.args, ['--liftoff-only', script, 'serve', '--mcp']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('MCP finds npm commands installed in another nvm version without switching Node', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airoom-mcp-nvm-'));
  const nvm = path.join(root, 'nvm');
  const old = path.join(nvm, 'v22.22.2');
  const script = path.join(old, 'node_modules', '@mcdxai', 'minecraft-dev-mcp', 'dist', 'index.js');
  try {
    await mkdir(path.dirname(script), { recursive: true });
    await mkdir(path.join(nvm, 'v26.13.0'));
    await writeFile(script, '// fixture');
    await writeFile(path.join(old, 'node.exe'), 'fixture');
    await writeFile(
      path.join(old, 'minecraft-dev-mcp.cmd'),
      '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\@mcdxai\\minecraft-dev-mcp\\dist\\index.js" %*\r\n',
    );
    const ctx = {
      cwd: root,
      env: { Path: path.join(nvm, 'v26.13.0'), NVM_HOME: nvm, AIROOM_NODE_EXE: process.execPath },
    };
    const result = nativeStdio(
      {
        name: 'minecraft-dev',
        enabled: true,
        transport: 'stdio',
        command: 'minecraft-dev-mcp',
        args: [],
      },
      ctx,
    );
    assert.equal(result.command, path.join(old, 'node.exe'));
    assert.deepEqual(result.args, [script]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project-local commands win and arguments remain literal argv entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airoom-mcp-local-'));
  const local = path.join(root, 'node_modules', '.bin');
  const global = path.join(root, 'global');
  try {
    await mkdir(local, { recursive: true });
    await mkdir(global);
    await writeFile(path.join(local, 'tool.exe'), 'local');
    await writeFile(path.join(global, 'tool.exe'), 'global');
    const args = ['a & b', '"quoted"', '%NAME%', '中文路径'];
    const result = resolveMcpCommand('tool.exe', args, root, { Path: global });
    assert.equal(result.command, path.join(local, 'tool.exe'));
    assert.deepEqual(result.args, args);
    assert.deepEqual(result.env, {});
    await writeFile(path.join(local, 'unsupported.cmd'), '@echo hello & run-something');
    assert.throws(() => resolveMcpCommand('unsupported', [], root, {}), /不是可识别/);
    assert.throws(() => resolveMcpCommand('not-installed', [], root, {}), /未找到 MCP 命令/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
