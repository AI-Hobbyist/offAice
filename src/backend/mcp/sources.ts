import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { McpEntry, McpScope, McpServer, McpSource } from '../../shared/mcp';
import { validateServer } from './config';

export const MCP_SOURCES: { id: McpSource; label: string; detail: string }[] = [
  { id: 'app', label: '应用自身', detail: '使用应用保存的配置。' },
  { id: 'codex', label: 'ChatGPT / Codex 本地', detail: '导入 config.toml；不读取云端连接器。' },
  { id: 'chatgpt', label: 'ChatGPT 云端导出', detail: '请选择已导出文件，或手工添加 HTTP 地址。' },
  { id: 'claude-code', label: 'Claude Code', detail: '导入 .claude.json 和项目 .mcp.json。' },
  { id: 'claude-desktop', label: 'Claude Desktop', detail: '请选择 claude_desktop_config.json。' },
  { id: 'file', label: '自定义 JSON / TOML', detail: '请选择文件并指定格式。' },
];

export interface SourceInput {
  source: McpSource;
  file?: string;
  format?: 'json' | 'toml';
}

/** A read-only import. No CLI is launched and no source file is modified. */
export async function readMcpSource(
  input: SourceInput,
  scope: McpScope,
  projectDirectory?: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
) {
  const entries = new Map<string, McpEntry>();
  const files: string[] = [],
    issues: string[] = [];
  async function load(
    file: string,
    format: 'json' | 'toml',
    pick: (data: any) => unknown,
    optional: boolean,
  ) {
    let data: any;
    try {
      const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
      data = format === 'toml' ? parse(text) : JSON.parse(text);
      files.push(file);
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      issues.push(`无法读取配置文件：${file}`);
      return;
    }
    const servers = pick(data);
    if (servers === undefined) return;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      issues.push(`${file}：MCP 服务必须是对象。`);
      return;
    }
    for (const [name, raw] of Object.entries(servers)) {
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
          throw new Error('服务格式无效。');
        const value = raw as Record<string, any>;
        const known = new Set([
          'type',
          'command',
          'args',
          'env',
          'cwd',
          'url',
          'headers',
          'http_headers',
          'enabled',
          'startup_timeout_sec',
          'tool_timeout_sec',
          'bearer_token_env_var',
          'env_vars',
        ]);
        const unsupported = Object.keys(value).filter((key) => !known.has(key));
        if (unsupported.length) throw new Error(`未支持字段：${unsupported.join(', ')}。`);
        if (value.type && !['stdio', 'http', 'streamable-http'].includes(value.type))
          throw new Error('未支持的传输类型。');
        const transport = value.type === 'stdio' ? 'stdio' : value.url ? 'http' : 'stdio';
        const server: McpServer = {
          name,
          enabled: value.enabled ?? true,
          transport,
          command: value.command,
          args: value.args,
          cwd: value.cwd,
          env: value.env,
          url: value.url,
          headers: value.headers ?? value.http_headers,
          startupTimeoutMs:
            value.startup_timeout_sec === undefined ? undefined : value.startup_timeout_sec * 1000,
          toolTimeoutMs:
            value.tool_timeout_sec === undefined ? undefined : value.tool_timeout_sec * 1000,
        };
        if (value.env_vars !== undefined) {
          if (
            !Array.isArray(value.env_vars) ||
            value.env_vars.some((key: unknown) => typeof key !== 'string')
          )
            throw new Error('env_vars 格式无效。');
          server.env = { ...server.env };
          for (const key of value.env_vars) {
            if (!env[key]) throw new Error(`环境变量 ${key} 未设置。`);
            server.env[key] = env[key]!;
          }
        }
        if (value.bearer_token_env_var) {
          const token = env[value.bearer_token_env_var];
          if (!token) throw new Error('Bearer 环境变量未设置。');
          server.headers = { ...server.headers, Authorization: `Bearer ${token}` };
        }
        if (/\$\{/.test(JSON.stringify(server))) throw new Error('环境模板需展开后再导入。');
        entries.set(name, {
          server: validateServer(server),
          scope,
          source: input.source,
          file,
          layer: 'import',
        });
      } catch (error) {
        issues.push(`${file} / ${name}：${(error as Error).message}`);
      }
    }
  }
  if (input.source === 'app') return { entries: [], files, issues };
  if (input.file) {
    if (!['json', 'toml'].includes(input.format ?? ''))
      throw new Error('请选择 JSON 或 TOML 格式。');
    await load(
      path.resolve(input.file),
      input.format!,
      (data) => (input.format === 'toml' ? data.mcp_servers : data.mcpServers),
      false,
    );
  } else if (input.source === 'codex') {
    const root = env.CODEX_HOME || path.join(home, '.codex');
    await load(
      scope.scope === 'global'
        ? path.join(root, 'config.toml')
        : path.join(projectDirectory!, '.codex', 'config.toml'),
      'toml',
      (data) => data.mcp_servers,
      false,
    );
  } else if (input.source === 'claude-code') {
    const file = path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json');
    if (scope.scope === 'global') await load(file, 'json', (data) => data.mcpServers, false);
    else {
      await load(
        path.join(projectDirectory!, '.mcp.json'),
        'json',
        (data) => data.mcpServers,
        true,
      );
      await load(
        file,
        'json',
        (data) => {
          const key = Object.keys(data.projects ?? {}).find(
            (item) =>
              path.resolve(item).toLowerCase() === path.resolve(projectDirectory!).toLowerCase(),
          );
          return key ? data.projects[key].mcpServers : undefined;
        },
        true,
      );
    }
  } else {
    issues.push('此来源需要选择导出或配置文件；不会自动读取云端账号。');
  }
  if (!files.length && !issues.length) issues.push('未找到所选来源的配置文件。');
  return { entries: [...entries.values()], files, issues };
}
