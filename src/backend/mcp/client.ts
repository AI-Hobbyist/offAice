import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { McpServer } from '../../shared/mcp';
import { ownedProcessLaunch } from '../process-supervisor';
import { resolveAcpProgram } from '../adapters/acp';
import { redact, registerSecret } from '../security';

/** Short-lived SDK connection used for diagnostics and clients without a native MCP transport. */
export async function connectMcp(
  server: McpServer,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) {
  for (const value of [
    ...Object.values(server.env ?? {}),
    ...Object.values(server.headers ?? {}),
    ...(server.args ?? []),
  ])
    registerSecret(value);
  const client = new Client({ name: 'offaice', version: '0.1.0' });
  let diagnostic = '';
  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  if (server.transport === 'stdio') {
    const environment = { ...env, ...server.env };
    const program = resolveAcpProgram(server.command!, environment);
    const launch = ownedProcessLaunch(
      program.script ? env.AIROOM_NODE_EXE || process.execPath : program.file,
      [...(program.script ? [program.file] : []), ...(server.args ?? [])],
      cwd,
    );
    transport = new StdioClientTransport({
      ...launch,
      cwd,
      env: Object.fromEntries(
        Object.entries(environment).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => {
      diagnostic = String(redact(diagnostic + String(chunk))).slice(-2000);
    });
  } else {
    transport = new StreamableHTTPClientTransport(new URL(server.url!), {
      requestInit: { headers: server.headers },
      reconnectionOptions: {
        maxRetries: 0,
        maxReconnectionDelay: 1000,
        initialReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
  }
  const abort = () => {
    void client.close();
  };
  signal?.throwIfAborted();
  signal?.addEventListener('abort', abort, { once: true });
  const close = async () => {
    signal?.removeEventListener('abort', abort);
    await client.close();
  };
  try {
    await client.connect(transport, { timeout: server.startupTimeoutMs ?? 30000, signal });
    return {
      client,
      close,
      pid: transport instanceof StdioClientTransport ? transport.pid : undefined,
    };
  } catch (error) {
    await close();
    const status =
      (error as { status?: number; data?: { status?: number } }).status ??
      (error as { data?: { status?: number } }).data?.status;
    const detail =
      status === 401 || status === 403
        ? `HTTP ${status}：需要授权或凭据无效。`
        : (error as Error).message;
    throw new Error(String(redact([detail, diagnostic].filter(Boolean).join('\n'))));
  }
}
