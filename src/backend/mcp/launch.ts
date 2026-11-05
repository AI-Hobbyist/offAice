import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterContext } from '../../shared/types';
import type { McpServer } from '../../shared/mcp';
import { resolveAcpProgram } from '../adapters/acp';

/** Native MCP schemas lack cwd; the helper keeps that setting local to this server. */
export function nativeStdio(server: McpServer, ctx: AdapterContext) {
  if (!server.cwd || server.cwd === ctx.cwd)
    return { command: server.command, args: server.args ?? [], env: server.env ?? {} };
  const helper = [
    ctx.env.AIROOM_MCP_LAUNCH_HELPER,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mcp-launch.mjs'),
    path.resolve(ctx.env.AIROOM_APP_ROOT ?? process.cwd(), 'dist', 'mcp-launch.mjs'),
  ].find((file): file is string => Boolean(file && existsSync(file)));
  if (!helper) throw new Error('缺少 MCP 启动组件，请重新构建应用。');
  const program = resolveAcpProgram(server.command!, { ...ctx.env, ...server.env });
  const node = ctx.env.AIROOM_NODE_EXE || process.execPath;
  return {
    command: node,
    args: [
      helper,
      server.cwd,
      program.script ? node : program.file,
      ...(program.script ? [program.file] : []),
      ...(server.args ?? []),
    ],
    env: server.env ?? {},
  };
}
