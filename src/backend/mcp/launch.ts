import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterContext } from '../../shared/types';
import type { McpServer } from '../../shared/mcp';
import { mcpNodeEnvironment, resolveMcpCommand } from './command';

/** Native MCP schemas lack cwd; the helper keeps that setting local to this server. */
export function nativeStdio(server: McpServer, ctx: Pick<AdapterContext, 'cwd' | 'env'>) {
  const directory = server.cwd ? path.resolve(ctx.cwd, server.cwd) : ctx.cwd;
  const program = resolveMcpCommand(server.command!, server.args ?? [], directory, {
    ...ctx.env,
    ...server.env,
  });
  const environment = { ...server.env, ...program.env };
  if (directory === ctx.cwd)
    return { command: program.command, args: program.args, env: environment };
  const helper = [
    ctx.env.AIROOM_MCP_LAUNCH_HELPER,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mcp-launch.mjs'),
    path.resolve(ctx.env.AIROOM_APP_ROOT ?? process.cwd(), 'dist', 'mcp-launch.mjs'),
  ].find((file): file is string => Boolean(file && existsSync(file)));
  if (!helper) throw new Error('缺少 MCP 启动组件，请重新构建应用。');
  const node = ctx.env.AIROOM_NODE_EXE || process.execPath;
  return {
    command: node,
    args: [helper, directory, program.command, ...program.args],
    env: { ...environment, ...mcpNodeEnvironment(node) },
  };
}
