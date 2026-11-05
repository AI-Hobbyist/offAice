import path from 'node:path';
import type { AdapterContext } from '../../shared/types';
import type { McpEntry, McpServer } from '../../shared/mcp';
import { createHash } from 'node:crypto';
import { nativeStdio } from './launch';

/** External servers do not inherit a model's filesystem/network sandbox. */
export function mcpRestriction(ctx: AdapterContext): string | undefined {
  if (ctx.run.provider === 'deepseek') return 'DeepSeek API 保留只读审查边界，未开放外部 MCP。';
  if (ctx.conversation === 'room' || ctx.session.purpose?.startsWith('room-'))
    return '此聊天场景不开放外部 MCP。';
  const permissions = ctx.settings.permissions[ctx.run.provider];
  if (!ctx.session.writeMode) return '只读会话不开放无法隔离写入的外部 MCP。';
  if (!permissions?.network) return '禁止联网时不启动外部 MCP（stdio 服务也可能联网）。';
  if (permissions.commands === 'deny') return '禁止命令时不启动外部 MCP。';
  if (permissions.fileScope !== 'any') return '仅工作区权限无法约束外部 MCP；当前未开放。';
}

export function executableServers(ctx: AdapterContext): McpServer[] {
  if (mcpRestriction(ctx)) return [];
  return (ctx.mcp ?? [])
    .filter((entry) => entry.server.enabled)
    .map((entry) => ({
      ...entry.server,
      cwd: entry.server.cwd
        ? path.resolve(ctx.mcpProjectDirectory ?? ctx.cwd, entry.server.cwd)
        : ctx.cwd,
    }));
}

export function claudeMcpServers(ctx: AdapterContext): Record<string, unknown> {
  const servers = executableServers(ctx);
  return Object.fromEntries(
    servers.map((server) => [
      server.name,
      server.transport === 'stdio'
        ? { type: 'stdio', ...nativeStdio(server, ctx) }
        : { type: 'http', url: server.url, headers: server.headers },
    ]),
  );
}

export function acpMcpServers(
  ctx: AdapterContext,
  capabilities: { mcpCapabilities?: { http?: boolean } },
): unknown[] {
  return executableServers(ctx).map((server) => {
    if (server.transport === 'http') {
      if (!capabilities.mcpCapabilities?.http)
        throw new Error(`执行端未声明 HTTP MCP 能力：${server.name}，任务尚未发送。`);
      return {
        name: server.name,
        type: 'http',
        url: server.url,
        headers: Object.entries(server.headers ?? {}).map(([name, value]) => ({ name, value })),
      };
    }
    const launch = nativeStdio(server, ctx);
    return {
      name: server.name,
      command: launch.command,
      args: launch.args,
      env: Object.entries(launch.env).map(([name, value]) => ({ name, value })),
    };
  });
}

/** Explicitly disable inherited server names before adding the application's winning entries. */
export function codexMcpConfig(
  ctx: AdapterContext,
  inherited: Record<string, unknown>,
): { mcp_servers: Record<string, unknown> } {
  const servers: Record<string, unknown> = Object.fromEntries(
    [...new Set([...Object.keys(inherited), ...(ctx.session.nativeMcpServerNames ?? [])])].map(
      (name) => [
        name,
        Object.hasOwn(inherited, name)
          ? { enabled: false }
          : { enabled: false, command: process.execPath },
      ],
    ),
  );
  for (const server of executableServers(ctx)) {
    // Codex deep-merges tables, including env = {}. A fresh name avoids retaining any native fields.
    const suffix = createHash('sha256').update(JSON.stringify(server)).digest('hex').slice(0, 12);
    let name = `offaice_${server.name.slice(0, 32)}_${suffix}`;
    while (Object.hasOwn(inherited, name)) name += '_';
    if (Object.hasOwn(inherited, server.name)) {
      ctx.emit(
        'status',
        `MCP ${server.name} 使用独立连接名称，避免继承原生同名配置。`,
        { mcp: 'isolated', name },
        'derived',
      );
    }
    servers[name] =
      server.transport === 'stdio'
        ? {
            ...nativeStdio(server, ctx),
            enabled: true,
            startup_timeout_sec: (server.startupTimeoutMs ?? 30000) / 1000,
            tool_timeout_sec: (server.toolTimeoutMs ?? 60000) / 1000,
          }
        : {
            url: server.url,
            http_headers: server.headers,
            enabled: true,
            startup_timeout_sec: (server.startupTimeoutMs ?? 30000) / 1000,
            tool_timeout_sec: (server.toolTimeoutMs ?? 60000) / 1000,
          };
  }
  return { mcp_servers: servers };
}

export function activeMcp(entries: McpEntry[]): McpEntry[] {
  return entries.filter((entry) => entry.server.enabled);
}
