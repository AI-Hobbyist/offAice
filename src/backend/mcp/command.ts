import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface McpCommand {
  command: string;
  args: string[];
  /** Runtime overrides only; never forward the host's complete environment as MCP configuration. */
  env: Record<string, string>;
}

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.entries(env).findLast(([key]) => key.toUpperCase() === name)?.[1];
}

function fileExists(file: string): boolean {
  return existsSync(file) && statSync(file).isFile();
}

function installedNvmDirectories(env: NodeJS.ProcessEnv): string[] {
  const root = environmentValue(env, 'NVM_HOME');
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name))
    .sort((a, b) => {
      const left = a.name.slice(1).split('.').map(Number);
      const right = b.name.slice(1).split('.').map(Number);
      return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
    })
    .map((entry) => path.join(root, entry.name));
}

function commandDirectories(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const directories: string[] = [];
  let directory = path.resolve(cwd);
  while (true) {
    directories.push(path.join(directory, 'node_modules', '.bin'));
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  directories.push(...(environmentValue(env, 'PATH') ?? '').split(path.delimiter));
  if (process.platform === 'win32') {
    const appData = environmentValue(env, 'APPDATA');
    const prefix = environmentValue(env, 'NPM_CONFIG_PREFIX');
    if (prefix) directories.push(prefix);
    if (appData) directories.push(path.join(appData, 'npm'));
    directories.push(...installedNvmDirectories(env));
  }
  return [...new Set(directories.map((value) => value.replace(/^"|"$/g, '')).filter(Boolean))];
}

function findCommand(command: string, cwd: string, env: NodeJS.ProcessEnv): string {
  const given = command.trim().replace(/^"(.*)"$/, '$1');
  if (!given) throw new Error('请填写 MCP 命令名称或完整路径。');
  if (path.isAbsolute(given)) {
    if (!fileExists(given)) throw new Error(`找不到 MCP 程序：${given}`);
    return path.normalize(given);
  }
  if (/[\\/]/.test(given)) throw new Error('MCP 命令请填写名称或完整路径，参数填写在参数栏。');
  const extensions =
    process.platform === 'win32' && !path.extname(given)
      ? ['.exe', '.com', '.cmd', '.bat', '.js', '.mjs', '.cjs', '']
      : [''];
  for (const directory of commandDirectories(cwd, env)) {
    for (const extension of extensions) {
      const candidate = path.resolve(directory, given + extension);
      if (fileExists(candidate)) return candidate;
    }
  }
  throw new Error(
    `未找到 MCP 命令「${given}」。已检查项目本地命令、PATH、npm 全局目录和 nvm 已安装版本；请确认已安装，或填写完整路径。`,
  );
}

export function mcpNodeEnvironment(node: string): Record<string, string> {
  return process.versions.electron &&
    path.resolve(node).toLowerCase() === path.resolve(process.execPath).toLowerCase()
    ? { ELECTRON_RUN_AS_NODE: '1' }
    : {};
}

function nodeCommand(node: string, script: string, flags: string[], args: string[]): McpCommand {
  if (!fileExists(node)) throw new Error(`MCP 启动脚本指定的 Node.js 不存在：${node}`);
  if (!fileExists(script)) throw new Error(`MCP 启动脚本指向的入口不存在：${script}`);
  return { command: node, args: [...flags, script, ...args], env: mcpNodeEnvironment(node) };
}

function shimPath(shim: string, value: string): string {
  return path.resolve(path.dirname(shim), value.replace(/^%(?:~dp0|dp0%)[\\/]?/i, ''));
}

/** Resolve known Node launchers into argv, preserving flags without executing shell syntax. */
function nodeShim(file: string, args: string[], env: NodeJS.ProcessEnv): McpCommand {
  const source = readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .trim();
  const forwarding = source.match(
    /^@?"(%~dp0[^"\r\n]*node\.exe)"((?:\s+--[\w-]+(?:=[\w.-]+)?)*)\s+"(%~dp0[^"\r\n]*\.(?:js|mjs|cjs))"\s+%\*$/i,
  );
  if (forwarding) {
    return nodeCommand(
      shimPath(file, forwarding[1]),
      shimPath(file, forwarding[3]),
      forwarding[2].trim().split(/\s+/).filter(Boolean),
      args,
    );
  }
  const npm = source.match(/"(%(?:~dp0|dp0%)[\\/][^"\r\n]+?\.(?:js|mjs|cjs))"\s+%\*/i);
  if (npm) {
    const adjacentNode = path.join(path.dirname(file), 'node.exe');
    const node = fileExists(adjacentNode) ? adjacentNode : env.AIROOM_NODE_EXE || process.execPath;
    return nodeCommand(node, shimPath(file, npm[1]), [], args);
  }
  throw new Error(
    '此 MCP 启动脚本不是可识别的 npm 或 Node 启动器；请填写真实可执行文件或 JavaScript 入口。',
  );
}

export function resolveMcpCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): McpCommand {
  const file = findCommand(command, cwd, env);
  const extension = path.extname(file).toLowerCase();
  if (extension === '.cmd' || extension === '.bat') return nodeShim(file, args, env);
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    return nodeCommand(env.AIROOM_NODE_EXE || process.execPath, file, [], args);
  }
  if (['.ps1', '.vbs', '.lnk'].includes(extension))
    throw new Error('MCP 请使用可执行文件、JavaScript 或可识别的 Node 启动器。');
  return { command: file, args, env: {} };
}
