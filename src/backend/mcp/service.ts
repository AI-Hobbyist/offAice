import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { Store } from '../store';
import type { Project } from '../../shared/types';
import { MCP_METHODS, type McpConfiguration, type McpEntry, type McpImportPreview, type McpScope, type McpSource, type McpView } from '../../shared/mcp';
import { maskedServer, resolveMcp, restoreMasked, validateServer } from './config';
import { MCP_SOURCES, readMcpSource, type SourceInput } from './sources';
import { registerSecret } from '../security';

const empty = (): McpConfiguration => ({ imported: [], overrides: [] });
type Preview = { scope: McpScope; entries: McpEntry[]; source: McpSource; expires: number; revision: string };

/** Configuration is encrypted in SQLite; the wrapping key is protected by Electron safeStorage. */
export class McpService {
  private key?: Buffer;
  private previews = new Map<string, Preview>();

  constructor(private store: Pick<Store, 'get' | 'put'>) {}

  setKey(key: string) {
    const bytes = Buffer.from(key, 'base64');
    if (bytes.length !== 32) throw new Error('MCP 配置密钥无效。');
    this.key = bytes;
  }

  private scope(input: any): McpScope {
    if (input.scope === 'global') return { scope: 'global' };
    if (input.scope === 'project' && typeof input.projectId === 'string'
      && this.store.get<Project>('projects', input.projectId)) return { scope: 'project', projectId: input.projectId };
    throw new Error('请选择有效的 MCP 全局或项目作用域。');
  }

  private id(scope: McpScope) { return scope.scope === 'global' ? 'global' : `project:${scope.projectId}`; }

  private read(scope: McpScope): McpConfiguration {
    const record = this.store.get<{ iv: string; tag: string; data: string }>('mcp_config', this.id(scope));
    if (!record) return empty();
    if (!this.key) throw new Error('系统 MCP 凭据保护尚未准备好。');
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(record.iv, 'base64'));
    cipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const config: McpConfiguration = JSON.parse(Buffer.concat([cipher.update(Buffer.from(record.data, 'base64')), cipher.final()]).toString('utf8'));
    for (const server of [...config.imported.map(entry => entry.server), ...config.overrides]) {
      for (const value of [...Object.values(server.env ?? {}), ...Object.values(server.headers ?? {}), ...server.args ?? []]) registerSecret(value);
    }
    return config;
  }

  private write(scope: McpScope, config: McpConfiguration) {
    if (!this.key) throw new Error('系统 MCP 凭据保护不可用，未保存配置。');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
    this.store.put('mcp_config', this.id(scope), { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
  }

  private selected(scope: McpScope): McpSource {
    return this.read(scope).source ?? this.read({ scope: 'global' }).source ?? 'app';
  }

  effective(input: McpScope): McpEntry[] {
    const scope = this.scope(input);
    const filtered = (target: McpScope) => {
      const config = this.read(target);
      return { ...config, imported: config.imported.filter(entry => entry.source === this.selected(target)) };
    };
    return resolveMcp(filtered({ scope: 'global' }), scope.scope === 'project' ? filtered(scope) : undefined, scope);
  }

  private view(scope: McpScope): McpView {
    const config = this.read(scope);
    return { scope, source: this.selected(scope), inheritsSource: scope.scope === 'project' && !config.source,
      overrides: config.overrides.map(maskedServer),
      effective: this.effective(scope).map(entry => ({ ...entry, server: maskedServer(entry.server) })) };
  }

  async invoke(method: string, params: any = {}): Promise<unknown> {
    if (!(MCP_METHODS as readonly string[]).includes(method)) throw new Error('MCP 操作不可用。');
    if (method === 'mcp.sources') return MCP_SOURCES;
    const scope = this.scope(params);
    const config = this.read(scope);
    switch (method) {
      case 'mcp.list':
      case 'mcp.resolve': return this.view(scope);
      case 'mcp.source.save': {
        if (params.source !== 'inherit' && !MCP_SOURCES.some(source => source.id === params.source)) throw new Error('MCP 来源无效。');
        if (params.source === 'inherit' && scope.scope !== 'project') throw new Error('全局配置不能继承项目。');
        const source = params.source === 'inherit' ? undefined : params.source as McpSource;
        this.write(scope, { ...config, source, imported: source === config.source ? config.imported : [] });
        return this.view(scope);
      }
      case 'mcp.save': {
        const previous = config.overrides.find(server => server.name === params.server?.name)
          ?? this.effective(scope).find(entry => entry.server.name === params.server?.name)?.server;
        const server = validateServer(restoreMasked(params.server, previous));
        this.write(scope, { ...config, overrides: [...config.overrides.filter(item => item.name !== server.name), server] });
        return this.view(scope);
      }
      case 'mcp.delete':
        this.write(scope, { ...config, overrides: config.overrides.filter(item => item.name !== params.name) });
        return this.view(scope);
      case 'mcp.import.preview': {
        const source = params.source ?? this.selected(scope);
        if (!MCP_SOURCES.some(item => item.id === source)) throw new Error('MCP 来源无效。');
        const directory = scope.scope === 'project' ? this.store.get<Project>('projects', scope.projectId)!.directory : undefined;
        const result = await readMcpSource({ source, file: params.file, format: params.format } as SourceInput, scope, directory);
        const token = randomUUID();
        for (const [id, preview] of this.previews) if (preview.expires < Date.now()) this.previews.delete(id);
        if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value!);
        if (!result.issues.length) this.previews.set(token, { scope, source, entries: result.entries,
          expires: Date.now() + 10 * 60_000, revision: JSON.stringify([this.read({ scope: 'global' }), config]) });
        return { ...result, token, source, entries: result.entries.map(entry => ({ ...entry, server: maskedServer(entry.server) })) } satisfies McpImportPreview;
      }
      case 'mcp.import.apply': {
        const preview = this.previews.get(params.token);
        if (!preview || preview.expires < Date.now() || this.id(preview.scope) !== this.id(scope)
          || preview.revision !== JSON.stringify([this.read({ scope: 'global' }), config])) throw new Error('预览已过期或配置已变化，请重新预览。');
        const source = scope.scope === 'project' && !config.source && preview.source === this.selected(scope)
          ? undefined : preview.source;
        this.write(scope, { ...config, source, imported: preview.entries });
        this.previews.delete(params.token);
        return this.view(scope);
      }
    }
  }
}
