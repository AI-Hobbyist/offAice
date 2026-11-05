import { useEffect, useState } from 'react';
import { Check, FileInput, LoaderCircle, Plus, RefreshCw, X } from 'lucide-react';
import type { McpImportPreview, McpScope, McpServer, McpSource, McpView } from '../shared/mcp';
import type { Project } from '../shared/types';
import type { Invoke } from './ui';
import { McpIcon } from './mcp-icon';
import './mcp-settings.css';

type Source = { id: McpSource; label: string; detail: string };
type TestResult = { status: string; tools?: string[]; detail?: string; at: string };
const freshServer = (): McpServer => ({
  name: '',
  enabled: true,
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
});

export function McpSettings({
  invoke,
  projects,
  projectId,
}: {
  invoke: Invoke;
  projects: Project[];
  projectId?: string;
}) {
  const [target, setTarget] = useState(projectId ?? 'global');
  const scope: McpScope =
    target === 'global' ? { scope: 'global' } : { scope: 'project', projectId: target };
  return (
    <section className="mcp-settings" aria-label="MCP 配置">
      <header className="mcp-heading">
        <span className="mcp-heading-icon">
          <McpIcon size={26} />
        </span>
        <div>
          <h3>MCP 工具连接</h3>
          <p>配置独立保存在 AIROOM；其他应用仅用于导入。</p>
        </div>
      </header>
      {!projectId && (
        <label className="field">
          配置范围
          <select
            aria-label="MCP 配置范围"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="global">全局 · 所有项目</option>
            {projects
              .filter((project) => !project.kind)
              .map((project) => (
                <option key={project.id} value={project.id}>
                  项目 · {project.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <McpScopeSettings key={target} invoke={invoke} scope={scope} />
    </section>
  );
}

function McpScopeSettings({ invoke, scope }: { invoke: Invoke; scope: McpScope }) {
  const [view, setView] = useState<McpView>();
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<McpServer>();
  const [isNew, setIsNew] = useState(false);
  const [file, setFile] = useState('');
  const [format, setFormat] = useState<'json' | 'toml'>('json');
  const [preview, setPreview] = useState<McpImportPreview>();
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [notice, setNotice] = useState('');

  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function applyView(next: McpView) {
    setView(next);
    setTests(next.tests);
  }
  useEffect(() => {
    let active = true;
    void Promise.all([invoke<McpView>('mcp.list', scope), invoke<Source[]>('mcp.sources')])
      .then(([next, options]) => {
        if (active) {
          applyView(next);
          setSources(options);
        }
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function chooseFile() {
    const chosen = await invoke<string | null>('dialog.mcpConfig');
    if (chosen) {
      setFile(chosen);
      setFormat(chosen.toLowerCase().endsWith('.toml') ? 'toml' : 'json');
      setPreview(undefined);
    }
  }

  function changeSource(source: string) {
    void perform(async () => {
      applyView(await invoke<McpView>('mcp.source.save', { ...scope, source }));
      setPreview(undefined);
      setFile('');
      setNotice('已保存默认导入来源，已有服务保持不变。');
    });
  }

  function testConnection(server: McpServer) {
    if (
      !window.confirm(
        `测试「${server.name}」会${server.transport === 'stdio' ? '启动其命令' : '连接其服务器'}，只读取工具列表，不调用工具。继续？`,
      )
    )
      return;
    void perform(async () => {
      const result = await invoke<TestResult>('mcp.test', {
        ...scope,
        name: server.name,
        confirm: true,
      });
      setTests((previous) => ({ ...previous, [server.name]: result }));
    });
  }

  return (
    <div className="mcp-scope">
      {error && (
        <p className="mcp-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="mcp-notice" role="status">
          <Check size={14} />
          {notice}
        </p>
      )}
      {!view ? (
        <p>正在读取 MCP 配置…</p>
      ) : (
        <>
          <div className="mcp-import">
            <label className="field">
              默认导入来源
              <select
                aria-label="默认 MCP 导入来源"
                disabled={busy}
                value={view.inheritsSource ? 'inherit' : view.source}
                onChange={(event) => changeSource(event.target.value)}
              >
                {scope.scope === 'project' && <option value="inherit">继承全局导入来源</option>}
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mcp-muted">
              {sources.find((source) => source.id === view.source)?.detail}{' '}
              切换来源不会改变已保存服务。
            </p>
            {view.source !== 'app' && (
              <>
                <label className="field">
                  导入文件路径（留空使用来源默认路径）
                  <div className="mcp-file-row">
                    <input
                      aria-label="MCP 导入文件路径"
                      value={file}
                      onChange={(event) => {
                        setFile(event.target.value);
                        setPreview(undefined);
                      }}
                      placeholder="选择配置或导出文件"
                    />
                    <button
                      type="button"
                      className="button quiet"
                      disabled={busy}
                      onClick={() => void perform(chooseFile)}
                    >
                      <FileInput size={14} />
                      选择文件
                    </button>
                  </div>
                </label>
                {file && (
                  <label className="field">
                    文件格式
                    <select
                      aria-label="MCP 文件格式"
                      value={format}
                      onChange={(event) => {
                        setFormat(event.target.value as 'json' | 'toml');
                        setPreview(undefined);
                      }}
                    >
                      <option value="json">JSON</option>
                      <option value="toml">TOML</option>
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      setPreview(
                        await invoke<McpImportPreview>('mcp.import.preview', {
                          ...scope,
                          source: view.source,
                          file: file || undefined,
                          format,
                        }),
                      );
                    })
                  }
                >
                  <RefreshCw size={14} />
                  预览导入
                </button>
              </>
            )}
            {preview && (
              <div className="mcp-preview" aria-label="MCP 导入预览">
                <strong>预览 · {preview.entries.length} 个服务</strong>
                {preview.files.map((item) => (
                  <p className="mcp-file" key={item}>
                    {item}
                  </p>
                ))}
                {preview.entries.map((entry) => (
                  <p key={entry.server.name}>
                    {entry.server.name} · {entry.server.transport === 'stdio' ? 'stdio' : 'HTTP'} ·{' '}
                    {entry.server.enabled ? '启用' : '禁用'}
                  </p>
                ))}
                {preview.issues.map((issue, index) => (
                  <p className="mcp-error" key={index}>
                    {issue}
                  </p>
                ))}
                <p className="mcp-muted">
                  应用后替换本范围的导入快照，保留手工配置；不会修改来源文件。
                </p>
                <div className="mcp-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || preview.issues.length > 0}
                    onClick={() =>
                      void perform(async () => {
                        applyView(
                          await invoke<McpView>('mcp.import.apply', {
                            ...scope,
                            token: preview.token,
                          }),
                        );
                        setPreview(undefined);
                        setNotice('已导入到 AIROOM，下一轮生效。');
                      })
                    }
                  >
                    应用导入
                  </button>
                  <button
                    type="button"
                    className="button quiet"
                    disabled={busy}
                    onClick={() => setPreview(undefined)}
                  >
                    取消预览
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="mcp-list-heading">
            <h4>
              已保存的服务 <span>{view.effective.length}</span>
            </h4>
            <button
              type="button"
              className="button"
              disabled={busy || Boolean(editing)}
              onClick={() => {
                setEditing(freshServer());
                setIsNew(true);
              }}
            >
              <Plus size={14} />
              添加服务
            </button>
          </div>
          {!view.effective.length && (
            <div className="mcp-empty">
              <McpIcon size={32} />
              <strong>连接你的工具</strong>
              <p>添加 stdio 本地服务或 HTTP 远程服务，也可以从已有配置导入。</p>
            </div>
          )}
          {view.effective.map((entry) => {
            const server = entry.server;
            const local =
              entry.scope.scope === scope.scope &&
              (entry.scope.scope !== 'project' ||
                (scope.scope === 'project' && entry.scope.projectId === scope.projectId));
            const override = local && entry.layer === 'override';
            const result = tests[server.name];
            return (
              <article
                className={`mcp-server ${server.enabled ? '' : 'disabled'}`}
                key={server.name}
                aria-label={`MCP 服务 ${server.name}`}
              >
                <div className="mcp-server-title">
                  <McpIcon size={19} />
                  <strong>{server.name}</strong>
                  <span className="mcp-transport">
                    {server.transport === 'stdio' ? 'stdio' : 'HTTP'}
                  </span>
                  <label className="mcp-toggle">
                    <input
                      type="checkbox"
                      aria-label={`启用 ${server.name}`}
                      disabled={busy}
                      checked={server.enabled}
                      onChange={(event) =>
                        void perform(async () => {
                          applyView(
                            await invoke<McpView>('mcp.save', {
                              ...scope,
                              server: { ...server, enabled: event.target.checked },
                            }),
                          );
                          setTests((previous) => {
                            const next = { ...previous };
                            delete next[server.name];
                            return next;
                          });
                        })
                      }
                    />
                    启用
                  </label>
                </div>
                <p className="mcp-endpoint">{server.command ?? server.url}</p>
                <p className="mcp-muted">
                  {entry.scope.scope === 'global' ? '全局' : '项目'} ·{' '}
                  {entry.layer === 'override'
                    ? '手工配置'
                    : `从 ${sources.find((source) => source.id === entry.source)?.label ?? entry.source} 导入`}
                  {!local ? ' · 继承' : ''}
                  {!server.enabled ? ' · 已禁用，屏蔽同名继承服务' : ''}
                </p>
                {entry.file && <p className="mcp-file">导入来源：{entry.file}</p>}
                {result && (
                  <p
                    className={result.status === 'connected' ? 'mcp-connected' : 'mcp-error'}
                    role="status"
                  >
                    {result.status === 'connected'
                      ? `连接成功 · ${result.tools?.length ?? 0} 个工具`
                      : result.status === 'authentication-required'
                        ? '需要授权或有效凭据'
                        : '连接失败'}
                    {result.detail && `：${result.detail}`}
                    <small>{new Date(result.at).toLocaleString()}</small>
                  </p>
                )}
                <div className="mcp-actions">
                  <button
                    type="button"
                    className="button quiet"
                    disabled={busy || Boolean(editing)}
                    onClick={() => {
                      setEditing(server);
                      setIsNew(false);
                    }}
                  >
                    编辑{!local ? '项目覆盖' : ''}
                  </button>
                  <button
                    type="button"
                    className="button quiet"
                    disabled={busy || !server.enabled}
                    onClick={() => testConnection(server)}
                  >
                    测试连接
                  </button>
                  {override && (
                    <button
                      type="button"
                      className="button quiet"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          applyView(
                            await invoke<McpView>('mcp.delete', { ...scope, name: server.name }),
                          );
                        })
                      }
                    >
                      删除手工配置
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {editing && (
            <McpEditor
              key={editing.name + String(isNew)}
              server={editing}
              isNew={isNew}
              busy={busy}
              onCancel={() => setEditing(undefined)}
              onSave={(server) =>
                void perform(async () => {
                  applyView(await invoke<McpView>('mcp.save', { ...scope, server }));
                  setEditing(undefined);
                  setTests((previous) => {
                    const next = { ...previous };
                    delete next[server.name];
                    return next;
                  });
                  setNotice('已保存，下一轮生效。');
                })
              }
            />
          )}
          <details className="mcp-compatibility">
            <summary>执行端与使用范围</summary>
            <p>
              Claude、Codex、DSH：stdio / HTTP。其他 ACP 程序：stdio，HTTP 需执行端声明支持。ZCode
              暂未开放。
            </p>
            <p>
              外部 MCP
              需要允许修改、联网、执行命令和任意文件范围；只读或普通会议聊天保持关闭。首次在项目中启用会请求确认信任。
            </p>
          </details>
          <p className="mcp-muted">
            本页操作立即保存，下一轮生效。项目同名配置优先于全局；删除手工配置可恢复导入或继承值。
          </p>
        </>
      )}
      {busy && (
        <p className="mcp-busy" role="status">
          <LoaderCircle size={14} className="spin" />
          正在处理…
        </p>
      )}
    </div>
  );
}

function McpEditor({
  server,
  isNew,
  busy,
  onCancel,
  onSave,
}: {
  server: McpServer;
  isNew: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (server: McpServer) => void;
}) {
  const [draft, setDraft] = useState(server);
  const [args, setArgs] = useState(JSON.stringify(server.args ?? [], null, 2));
  const [env, setEnv] = useState(JSON.stringify(server.env ?? {}, null, 2));
  const [headers, setHeaders] = useState(JSON.stringify(server.headers ?? {}, null, 2));
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  function save() {
    try {
      const next = { ...draft };
      if (draft.transport === 'stdio') {
        next.args = JSON.parse(args);
        next.env = JSON.parse(env);
      } else {
        next.headers = JSON.parse(headers);
        if (token) next.headers = { ...next.headers, Authorization: `Bearer ${token}` };
      }
      onSave(next);
      setToken('');
    } catch {
      setError('参数、环境变量或 header 的 JSON 格式无效。');
    }
  }
  return (
    <form
      className="mcp-editor"
      aria-label="编辑 MCP 服务"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="mcp-list-heading">
        <h4>{isNew ? '添加服务' : `编辑 ${server.name}`}</h4>
        <button
          type="button"
          className="icon-button"
          aria-label="取消编辑 MCP"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={15} />
        </button>
      </div>
      <label className="field">
        服务名称
        <input
          aria-label="MCP 服务名称"
          autoFocus
          value={draft.name}
          disabled={!isNew || busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder="例如 filesystem"
          required
        />
      </label>
      <label className="field">
        传输方式
        <select
          aria-label="MCP 传输方式"
          value={draft.transport}
          disabled={busy}
          onChange={(event) =>
            setDraft({ ...draft, transport: event.target.value as 'stdio' | 'http' })
          }
        >
          <option value="stdio">stdio · 本地命令</option>
          <option value="http">HTTP · 远程服务</option>
        </select>
      </label>
      {draft.transport === 'stdio' ? (
        <>
          <label className="field">
            启动命令
            <input
              aria-label="MCP 启动命令"
              value={draft.command ?? ''}
              onChange={(event) => setDraft({ ...draft, command: event.target.value })}
              placeholder="可执行文件或脚本路径"
              required
            />
          </label>
          <label className="field">
            参数（JSON 字符串数组）
            <textarea
              aria-label="MCP 参数"
              rows={3}
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            环境变量（JSON 对象）
            <textarea
              aria-label="MCP 环境变量"
              rows={3}
              value={env}
              onChange={(event) => setEnv(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            工作目录（可选）
            <input
              aria-label="MCP 工作目录"
              value={draft.cwd ?? ''}
              onChange={(event) => setDraft({ ...draft, cwd: event.target.value || undefined })}
              placeholder="留空使用当前执行目录；相对路径基于项目根目录"
            />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            服务器 URL
            <input
              aria-label="MCP 服务器 URL"
              type="url"
              value={draft.url ?? ''}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              placeholder="https://example.com/mcp"
              required
            />
          </label>
          <label className="field">
            HTTP headers（JSON 对象）
            <textarea
              aria-label="MCP HTTP headers"
              rows={3}
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            Bearer Token（可选）
            <input
              aria-label="MCP Bearer Token"
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="填写时更新 Authorization；留空保留已有配置"
            />
          </label>
        </>
      )}
      <div className="mcp-timeouts">
        <label className="field">
          启动超时（秒）
          <input
            aria-label="MCP 启动超时"
            type="number"
            min="1"
            max="600"
            value={(draft.startupTimeoutMs ?? 30000) / 1000}
            onChange={(event) =>
              setDraft({ ...draft, startupTimeoutMs: Number(event.target.value) * 1000 })
            }
          />
        </label>
        <label className="field">
          调用超时（秒）
          <input
            aria-label="MCP 调用超时"
            type="number"
            min="1"
            max="600"
            value={(draft.toolTimeoutMs ?? 60000) / 1000}
            onChange={(event) =>
              setDraft({ ...draft, toolTimeoutMs: Number(event.target.value) * 1000 })
            }
          />
        </label>
      </div>
      <p className="mcp-muted">
        超时用于连接测试和支持这些选项的执行端；其他执行端使用其原生超时。
      </p>
      <p className="mcp-muted">已保存的密钥和参数以圆点显示，保留圆点即保留原值。</p>
      {error && (
        <p className="mcp-error" role="alert">
          {error}
        </p>
      )}
      <div className="mcp-actions">
        <button type="submit" className="button primary" disabled={busy}>
          保存服务
        </button>
        <button type="button" className="button quiet" disabled={busy} onClick={onCancel}>
          取消编辑
        </button>
      </div>
    </form>
  );
}
