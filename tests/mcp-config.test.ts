import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/backend/store';
import { McpService } from '../src/backend/mcp/service';
import { readMcpSource } from '../src/backend/mcp/sources';
import { MCP_REDACTED, type McpView, type McpImportPreview } from '../src/shared/mcp';

test('scope overrides, disabled tombstones, project isolation and encrypted persistence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'airoom-mcp-'));
  const store = new Store(directory);
  const key = randomBytes(32).toString('base64');
  const service = new McpService(store);
  service.setKey(key);
  const global = { scope: 'global' };
  const project = { scope: 'project', projectId: 'p' };
  store.put('projects', 'p', { id: 'p', directory });
  store.put('projects', 'q', { id: 'q', directory });
  try {
    const server = { name: 'echo', enabled: true, transport: 'stdio', command: 'never-launch-this-command',
      args: ['argument-secret-123'], env: { KEY: 'credential-123456' } };
    const view = await service.invoke('mcp.save', { ...global, server }) as McpView;
    assert.equal(view.effective[0].server.env!.KEY, MCP_REDACTED);
    assert.equal(view.effective[0].server.args![0], MCP_REDACTED);
    await service.invoke('mcp.save', { ...project, server: { ...server, enabled: false, env: {} } });
    assert.equal(service.effective({ scope: 'project', projectId: 'p' })[0].server.enabled, false);
    assert.equal(service.effective({ scope: 'project', projectId: 'q' })[0].server.enabled, true);
    await service.invoke('mcp.delete', { ...project, name: 'echo' });
    assert.equal(service.effective({ scope: 'project', projectId: 'p' })[0].server.env!.KEY, 'credential-123456');
    await service.invoke('mcp.save', { ...global, server: view.overrides[0] });
    assert.equal(service.effective({ scope: 'global' })[0].server.args![0], 'argument-secret-123');
    const reopened = new McpService(store);
    reopened.setKey(key);
    assert.equal(reopened.effective({ scope: 'global' })[0].server.env!.KEY, 'credential-123456');
    assert.ok(!JSON.stringify(store.get('mcp_config', 'global')).includes('credential-123456'));
    await assert.rejects(service.invoke('mcp.list', { scope: 'project', projectId: 'missing' }));
    await assert.rejects(service.invoke('mcp.save', { ...global, server: { ...server, name: 'airoom' } }));
    await assert.rejects(service.invoke('mcp.save', { ...global, server: { ...server, transport: 'sse' } }));
    await assert.rejects(service.invoke('mcp.source.save', { ...global, source: 'inherit' }));
  } finally {
    store.close();
    const bytes = await readFile(path.join(directory, 'airoom.sqlite'));
    assert.ok(!bytes.includes(Buffer.from('credential-123456')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('import is preview/apply, errors are atomic and source changes retain manual overrides', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'airoom-mcp-import-'));
  const store = new Store(directory), service = new McpService(store);
  service.setKey(randomBytes(32).toString('base64'));
  try {
    const file = path.join(directory, 'mcp.json');
    const contents = JSON.stringify({ mcpServers: { remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer private-token-123' } } } });
    await writeFile(file, contents);
    const params = { scope: 'global', source: 'file', file, format: 'json' };
    const preview = await service.invoke('mcp.import.preview', params) as McpImportPreview;
    assert.deepEqual(preview.issues, []);
    assert.equal(service.effective({ scope: 'global' }).length, 0);
    assert.ok(!JSON.stringify(preview).includes('private-token-123'));
    await assert.rejects(service.invoke('mcp.import.apply', { scope: 'project', projectId: 'missing', token: preview.token }));
    await service.invoke('mcp.import.apply', { scope: 'global', token: preview.token });
    assert.equal(service.effective({ scope: 'global' })[0].server.transport, 'http');
    assert.equal(await readFile(file, 'utf8'), contents);
    await writeFile(file, '{');
    const bad = await service.invoke('mcp.import.preview', params) as McpImportPreview;
    assert.equal(bad.issues.length, 1);
    await assert.rejects(service.invoke('mcp.import.apply', { scope: 'global', token: bad.token }));
    assert.equal(service.effective({ scope: 'global' }).length, 1);
    await service.invoke('mcp.save', { scope: 'global', server: { name: 'manual', enabled: true, transport: 'http', url: 'https://manual.test/mcp' } });
    await service.invoke('mcp.source.save', { scope: 'global', source: 'app' });
    assert.deepEqual(service.effective({ scope: 'global' }).map(entry => entry.server.name), ['manual']);
    await writeFile(file, contents);
    const stale = await service.invoke('mcp.import.preview', params) as McpImportPreview;
    await service.invoke('mcp.source.save', { scope: 'global', source: 'codex' });
    await assert.rejects(service.invoke('mcp.import.apply', { scope: 'global', token: stale.token }), /配置已变化/);
    store.put('projects', 'p', { id: 'p', directory });
    const project = { scope: 'project', projectId: 'p' };
    const inherited = await service.invoke('mcp.list', project) as McpView;
    assert.equal(inherited.inheritsSource, true);
    assert.equal(inherited.source, 'codex');
    const noKey = new McpService(store);
    await assert.rejects(noKey.invoke('mcp.list', { scope: 'global' }), /保护/);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('TOML fields, unsupported input and Claude project precedence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'airoom-mcp-source-'));
  try {
    const file = path.join(directory, 'config.toml');
    await writeFile(file, '[mcp_servers.echo]\ncommand = "not-executed"\nargs = ["hello"]\n');
    const result = await readMcpSource({ source: 'codex', file, format: 'toml' }, { scope: 'global' });
    assert.deepEqual(result.issues, []);
    assert.equal(result.entries[0].server.command, 'not-executed');
    const user = path.join(directory, '.claude.json');
    await writeFile(user, JSON.stringify({ projects: { [directory]: { mcpServers: { echo: { command: 'local' } } } } }));
    await writeFile(path.join(directory, '.mcp.json'), JSON.stringify({ mcpServers: { echo: { command: 'project' } } }));
    const project = await readMcpSource({ source: 'claude-code' }, { scope: 'project', projectId: 'p' }, directory, {}, directory);
    assert.equal(project.entries[0].server.command, 'local');
    await writeFile(file, '[mcp_servers.bad]\ntype = "sse"\nurl = "https://example.test/sse"');
    assert.equal((await readMcpSource({ source: 'file', file, format: 'toml' }, { scope: 'global' })).issues.length, 1);
    await writeFile(file, '[mcp_servers.bad]\ncommand = "echo"\nunknown = true');
    assert.match((await readMcpSource({ source: 'file', file, format: 'toml' }, { scope: 'global' })).issues[0], /unknown/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
