import { createHash } from 'node:crypto';
import {
  MCP_REDACTED,
  type McpConfiguration,
  type McpEntry,
  type McpScope,
  type McpServer,
} from '../../shared/mcp';

export function validateServer(value: McpServer): McpServer {
  if (!value || !/^[\w.-]{1,80}$/.test(value.name) || value.name.toLowerCase() === 'airoom') {
    throw new Error('MCP 名称须为 1–80 个字母、数字、下划线、点或短横线，airoom 为保留名称。');
  }
  if (typeof value.enabled !== 'boolean' || !['stdio', 'http'].includes(value.transport)) {
    throw new Error('MCP 启用状态或传输类型无效。');
  }
  for (const map of [value.env, value.headers]) {
    if (
      map !== undefined &&
      (!map ||
        typeof map !== 'object' ||
        Array.isArray(map) ||
        Object.entries(map).some(
          ([key, item]) => !key || typeof item !== 'string' || /[\r\n\0]/.test(key + item),
        ))
    ) {
      throw new Error('MCP 环境变量或 HTTP header 格式无效。');
    }
  }
  if (value.transport === 'stdio') {
    if (
      typeof value.command !== 'string' ||
      !value.command.trim() ||
      /[\r\n\0]/.test(value.command)
    ) {
      throw new Error('请填写 MCP 启动命令。');
    }
    if (
      value.args !== undefined &&
      (!Array.isArray(value.args) ||
        value.args.some((item) => typeof item !== 'string' || item.includes('\0')))
    ) {
      throw new Error('MCP 参数须为字符串数组。');
    }
    if (
      value.cwd !== undefined &&
      (typeof value.cwd !== 'string' || !value.cwd || value.cwd.includes('\0'))
    ) {
      throw new Error('MCP 工作目录无效。');
    }
  } else {
    const url = new URL(value.url ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('MCP URL 须为 HTTP/HTTPS 地址，凭据请放入 header。');
    }
    if (url.search) throw new Error('MCP URL 不接受查询参数；凭据请放入 header。');
  }
  for (const timeout of [value.startupTimeoutMs, value.toolTimeoutMs]) {
    if (
      timeout !== undefined &&
      (!Number.isInteger(timeout) || timeout < 100 || timeout > 600000)
    ) {
      throw new Error('MCP 超时须为 100–600000 毫秒。');
    }
  }
  const common = {
    name: value.name,
    enabled: value.enabled,
    transport: value.transport,
    startupTimeoutMs: value.startupTimeoutMs,
    toolTimeoutMs: value.toolTimeoutMs,
  };
  return value.transport === 'stdio'
    ? {
        ...common,
        command: value.command,
        args: value.args ?? [],
        cwd: value.cwd,
        env: value.env ?? {},
      }
    : { ...common, url: value.url, headers: value.headers ?? {} };
}

/** The whole winning entry replaces the previous one, including a disabled tombstone. */
export function resolveMcp(
  global: McpConfiguration,
  project?: McpConfiguration,
  projectScope?: McpScope,
): McpEntry[] {
  const result = new Map<string, McpEntry>();
  function add(config: McpConfiguration, scope: McpScope) {
    for (const entry of config.imported) result.set(entry.server.name, entry);
    for (const server of config.overrides)
      result.set(server.name, { server, scope, source: 'app', layer: 'override' });
  }
  add(global, { scope: 'global' });
  if (project && projectScope) add(project, projectScope);
  return [...result.values()].sort((a, b) => a.server.name.localeCompare(b.server.name));
}

export function maskedServer(server: McpServer): McpServer {
  const hide = (map?: Record<string, string>) =>
    map && Object.fromEntries(Object.keys(map).map((key) => [key, MCP_REDACTED]));
  // Arguments may contain arbitrary credentials, so redact every value in read views.
  return {
    ...server,
    args: server.args?.map(() => MCP_REDACTED),
    env: hide(server.env),
    headers: hide(server.headers),
  };
}

export function restoreMasked(server: McpServer, previous?: McpServer): McpServer {
  const restore = (
    map: Record<string, string> | undefined,
    old: Record<string, string> | undefined,
  ) =>
    map &&
    Object.fromEntries(
      Object.entries(map).map(([key, value]) => {
        if (value === MCP_REDACTED && old?.[key] === undefined)
          throw new Error('密钥占位符没有对应的已保存值。');
        return [key, value === MCP_REDACTED ? old![key] : value];
      }),
    );
  return {
    ...server,
    args: server.args?.map((value, index) => {
      if (value === MCP_REDACTED && previous?.args?.[index] === undefined)
        throw new Error('参数占位符没有对应的已保存值。');
      return value === MCP_REDACTED ? previous!.args![index] : value;
    }),
    env: restore(server.env, previous?.env),
    headers: restore(server.headers, previous?.headers),
  };
}

export const mcpFingerprint = (entries: McpEntry[]) =>
  createHash('sha256').update(JSON.stringify(entries)).digest('hex');
