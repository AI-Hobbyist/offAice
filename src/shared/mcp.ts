export const MCP_METHODS = [
  'mcp.list', 'mcp.save', 'mcp.delete', 'mcp.sources',
  'mcp.import.preview', 'mcp.import.apply', 'mcp.resolve', 'mcp.source.save',
] as const;

export type McpSource = 'app' | 'codex' | 'chatgpt' | 'claude-code' | 'claude-desktop' | 'file';
export type McpScope = { scope: 'global' } | { scope: 'project'; projectId: string };
export const MCP_REDACTED = '••••••••';

export interface McpServer {
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  startupTimeoutMs?: number;
  toolTimeoutMs?: number;
}

export interface McpEntry {
  server: McpServer;
  source: McpSource;
  file?: string;
  scope: McpScope;
  layer: 'import' | 'override';
}

export interface McpConfiguration {
  source?: McpSource;
  imported: McpEntry[];
  overrides: McpServer[];
}

export interface McpView {
  scope: McpScope;
  source: McpSource;
  inheritsSource: boolean;
  overrides: McpServer[];
  effective: McpEntry[];
}

export interface McpImportPreview {
  token: string;
  source: McpSource;
  entries: McpEntry[];
  files: string[];
  issues: string[];
}
