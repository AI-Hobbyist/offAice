# MCP 支持实施计划

日期：2026-11-05
状态：实施中。M1 已提交并推送（534b377）；M2 自动验证通过，待 Git 检查点；M3–M4 未开始。

## 1. 目标与范围

为 offAice（当前代码内部名称 AIROOM）提供可管理、可诊断、能被实际模型调用的 MCP 支持：

- 全局配置适用于全部项目，项目配置可覆盖、补充或禁用全局条目。
- 可选择默认配置来源，包括应用自身、ChatGPT / Codex、Claude Code、Claude Desktop 和自定义文件；来源与模型执行端独立。
- 支持 stdio 与 Streamable HTTP。HTTP 明确定义为 MCP Streamable HTTP，而不是任意 REST API。旧 HTTP+SSE 暂不列入本期验收，导入时明确提示不支持，不擅自改成 HTTP。
- 优先复用现有执行端接口；对确实没有可复用入口的路径，补充最小客户端与工具调用接入。
- 完成标准包含模型实际发现并调用工具，不能仅以“配置已保存”或“测试连接成功”交付。

本期不包含 MCP 市场、服务端开发平台、插件系统重构、跨设备同步、完整 resources/prompts 浏览器、sampling 或自动安装 MCP 服务依赖。OAuth 服务的支持按现有执行端能力提供，缺失时显示需授权/不支持，不另行扩展通用 OAuth 平台。

## 2. 已核实的现状

| 位置 | 当前行为 | 复用结论 |
| --- | --- | --- |
| `src/backend/adapters/claude.ts:353–362` | 通过 `--mcp-config` 注入内部 `airoom` stdio 服务，并启用 `--strict-mcp-config` | 已有真正的 MCP 配置注入入口，扩展配置合成即可；保留内部审批服务 |
| `src/backend/adapters/claude-permission-mcp.ts` | 实现 `permission_prompt`、`ask_user` 的 stdio MCP 服务 | 这是内部服务端，不是通用客户端；不把它改造成外部 MCP 客户端 |
| `src/backend/adapters/acp.ts:316–327` | new/load/resume 会话请求带 `mcpServers: []` | 已有参数接口但没有注入用户服务，优先复用 |
| `src/backend/adapters/dsh.ts:559–564` | new/resume 请求带 `mcpServers: []` | 同上；探测会话仍保持空配置，避免探测启动用户服务 |
| `src/backend/adapters/codex.ts:69–75, 286–310, 509` | 使用原生 app-server，thread 参数已有 `config` 注入，处理 MCP elicitation 请求 | 复用原生客户端，实施时以当前安装版本 schema 核验 MCP 配置注入与覆盖语义；不能由 elicitation 分支推断全部 MCP 已完成 |
| `src/backend/adapters/acp-chat.ts`、`claude-models.ts`、`claude-quota.ts` | 普通受限聊天/配置与额度探测明确传空 MCP 配置 | 保留现有行为，不把所有调用一律接入 MCP |
| `src/shared/rpc-methods.ts` | renderer RPC 白名单没有 MCP 管理方法 | 新增 MCP 管理方法，但复用现有 bridge/RPC 通道 |
| `src/shared/types.ts:366–410` | AdapterContext/Adapter 尚无统一有效 MCP 配置与管理接口 | 在现有上下文上增加字段，不新建平行执行引擎 |
| `src/backend/store.ts` | 以本地 SQLite entities 保存应用状态 | 复用存储，不引入新数据库 |
| `src/backend/runtime-pool.ts:17–32` | 运行时指纹已有权限、环境与部分配置文件信息 | 纳入有效 MCP 配置版本和凭据版本，防止复用旧配置连接 |
| `package.json` / `package-lock.json` | 无应用直接声明的通用 MCP SDK；锁文件含 DSH 的传递客户端依赖 | 传递依赖不等于应用入口；需要自有客户端时声明直接运行时依赖 |

结论：已有多个可复用的执行端入口，但尚无统一用户配置、来源选择和管理界面。本次未运行真实 MCP 服务，不将原生执行端对两种传输的实际兼容性记为已验证。

## 3. 配置来源与作用域

### 3.1 来源选择

全局提供“默认 MCP 导入来源”；项目提供“继承全局 / 单独选择”。AIROOM 的配置独立保存，外部产品仅作为导入来源。默认选择“应用自身”，不自动扫描后执行外部命令。

来源选择用于读取和导入配置，不改变模型、账号或执行端。每次读取展示文件路径、范围、条目、传输类型和错误；导入为应用保存的快照，外部文件变化通过“刷新预览 → 应用”生效。本期不做隐式实时跟随，不修改来源文件。

| 来源 | 计划读取方式 |
| --- | --- |
| 应用自身 | 已保存的全局/项目配置；支持手工新增 |
| ChatGPT / Codex 本地配置 | 读取已确认的 Codex TOML 配置，常见入口为 `~/.codex/config.toml` 与项目 `.codex/config.toml`；尊重实际配置目录覆盖。界面写明具体产品和文件，不把 ChatGPT 云端连接器当成本地文件 |
| ChatGPT 云端配置 | 支持用户提供的已导出文件或手工填写 URL；未发现官方可读接口时显示“需导出/手工提供”，不读取账号私有数据库、不假装自动同步 |
| Claude Code | 读取 `~/.claude.json` 的用户级及当前项目 local 条目、项目 `.mcp.json`；保留来源内部优先级并显示冲突 |
| Claude Desktop | 作为独立来源解析用户选择的 `claude_desktop_config.json`；候选路径必须在实施时按平台和官方文档核验，不与 Claude Code 配置混同 |
| 自定义文件 | 用户选择 JSON/TOML 文件，明确选择格式；不猜测不兼容字段 |

适配器只导入可解释字段；不支持的传输、动态凭据、模板或扩展字段逐项报告，禁止静默丢失。导入不会复制其他产品的登录态或 OAuth token。

### 3.2 生效规则

由低到高：选定来源的全局快照 → 应用全局覆盖 → 选定来源的项目快照 → 应用项目覆盖 → 既有执行场景权限过滤。

- 项目未指定来源时，继承全局来源种类；刷新预览同时列出该来源针对当前项目的条目。
- 以服务名称作为覆盖键，整条覆盖，不将不同来源的 command/env/headers 混合拼接。
- 项目同名 `enabled: false` 是禁用标记，可屏蔽全局服务；删除项目覆盖恢复继承。
- 相同层出现同名冲突时要求在预览中解决，禁止依赖文件枚举顺序。
- 保留内部 `airoom` 名称，用户同名配置报错；不允许覆盖审批服务。
- 切换默认导入来源不改变已导入或手工保存的服务；只有应用导入时才替换对应范围的导入快照，保留手工覆盖。取消预览不改变配置。
- 项目按现有 Project ID 隔离；导入路径基于项目根目录，不基于每次运行临时工作副本。
- 显示最终来源及被覆盖/禁用原因。保存从下一轮生效，不在进行中的工具调用中热替换。

## 4. 数据与接口设计

新增统一 MCP 类型，建议独立于庞大的通用类型文件保存，再由 AdapterContext 引用。

- 公共字段：name、enabled、transport、来源信息、作用域、启动/调用超时。
- stdio：command、args 数组、env/环境变量引用、可选 cwd。
- HTTP：url、headers/凭据引用；支持无认证和显式 Bearer/header 配置。
- 持久化配置与脱敏视图分离，凭据复用现有加密保存通道；renderer 快照、日志、导出不包含明文密钥。
- 项目相对 cwd 以绑定的项目根解析；不设置时使用实际执行工作目录。跨项目运行时不得共用带有另一个项目 cwd 或凭据的连接。

建议 RPC：`mcp.list`、`mcp.save`、`mcp.delete`、`mcp.sources`、`mcp.import.preview`、`mcp.import.apply`、`mcp.resolve`、`mcp.test`。参数必须包含明确作用域，项目级请求校验 projectId；读配置与测试连接分开，读配置不启动服务。

`mcp.test` 执行初始化、能力协商与 tools/list，返回状态、工具数量及脱敏错误，完成后关闭连接。工具真实调用通过执行端或集成测试验证，不在“测试连接”中自动调用有副作用工具。

建议新增文件职责：`src/shared/mcp.ts`、`src/backend/mcp/config.ts`、`sources.ts`、`service.ts`、`src/renderer/mcp-settings.tsx`。只有确需自有协议客户端时增加 `client.ts`，不为每个执行端重复实现协议层。

## 5. 执行端接入

### 5.1 Claude

合成用户有效配置与内部审批服务，继续使用 strict 模式；既有场景权限仍然生效。普通只读/禁止工具的聊天、模型探测和额度探测不因新增 MCP 而放开工具。覆盖 stdio 和 HTTP 的原生字段映射与错误显示。

### 5.2 ACP / DSH

将统一配置转换为 session/new、session/load、session/resume 的 mcpServers；HTTP 仅在初始化声明 `mcpCapabilities.http` 后注入。初始化探测不启动用户 MCP。确保恢复会话收到当前配置；不支持配置更新时创建新的原生上下文并按现有机制恢复必要历史，不能悄悄沿用旧服务。

### 5.3 Codex

先用安装版本的 app-server schema 确认 thread/start、thread/resume 的 config MCP 字段和实际加载行为，复用现有参数入口。重点验证原生配置合并是否会额外加载全局服务，以及显式禁用是否真正生效；不得宣称传入空表就能清空继承配置。不覆盖用户官方配置文件，不改订阅认证与 sandbox 行为。

### 5.4 无原生入口的执行路径

首先区分“没有配置映射”与“没有模型工具调用接口”。前者补映射即可；后者在现有模型请求循环接入工具声明、调用路由、结果回传，并使用官方 MCP SDK 实现 stdio/HTTP 客户端。自有客户端必须参与真实模型回合；仅列出工具的孤立客户端不算完成。

不能把一个不支持工具调用的外接程序标记为支持 MCP。若实现该程序需要改造既有架构边界，记录具体差距并请求范围决策，其他已支持执行端继续交付。最终界面按执行端分别展示 stdio/HTTP 的支持、未验证或不支持状态。

## 6. 生命周期与权限

- 连接按执行端/项目/配置指纹隔离；配置或凭据变化使闲置连接失效，活动轮次使用已冻结快照。
- stdio 使用现有启动和进程清理设施，command 与 args 分离；stdout 专用于协议，stderr 收集脱敏诊断。停止、超时、退出后清理自有子进程。
- HTTP 支持 JSON 与 SSE 流响应、协商版本及服务端会话状态；具体行为交给选定 SDK/原生执行端，不手写第二套协议。
- 不自动重放结果未知的有副作用调用；允许重新连接与重新发现工具，不等于重复执行调用。
- 配置导入不等于授权执行。项目来源首次启用展示命令/地址，复用现有审批通道确认信任；记录配置指纹，命令/地址变化需重新确认。
- 现有网络关闭、命令禁止、只读和聊天限制必须实际约束 MCP。MCP 服务未必受模型执行端沙箱约束，不能用只读提示词作为权限证据。无法落实限制时在该场景禁用对应外部 MCP 并显示原因；工具的 readOnly 标记不能独自成为写入授权依据。
- OAuth 能力按执行端报告；不支持时明确给出状态和可用的手工凭据方式，不降级成匿名连接。

## 7. UI 方案

全局设置增加“MCP”页；项目设置增加同结构页面及继承状态。按用户补充要求，自绘符合现有风格的 SVG MCP 图标。

页面包含默认来源选择、导入预览、服务列表、新增/编辑、启用/禁用、删除覆盖、测试连接。列表展示名称、stdio/HTTP、实际来源、继承关系、执行端兼容状态和最近测试结果。编辑 stdio 显示命令/参数/环境；编辑 HTTP 显示 URL/header/认证引用。密钥显示已配置状态。

运行日志展示服务连接、工具调用和失败原因，复用现有 TimelineEvent/approval，而不是单独创建另一套交互。设置页面不展示协议内部实现细节。

## 8. 分阶段实施与验收

以下阶段严格按顺序实施，每阶段完成 Git 检查点后进入下一阶段。

| 阶段 | 工作 | 自动验收条件 |
| --- | --- | --- |
| M1 配置与来源 | 统一类型、Store、层级解析、来源适配、脱敏 RPC | 全局/项目覆盖、禁用、冲突、来源切换、导入失败无写入、密钥不泄露；解析不启动命令 |
| M2 执行接入 | 优先完成 Claude、Codex、ACP/DSH 映射；需要时增加自有客户端 | 对两个传输分别验证初始化、发现、真实调用与结果回传；恢复会话及不支持能力有明确结果；原审批服务正常 |
| M3 管理界面 | 全局/项目 UI、来源预览、测试连接、错误显示 | UI 自动化覆盖编辑、继承、禁用、来源切换和测试结果；调用真实应用窗口验证端到端 |
| M4 回归与交付 | 权限、生命周期、打包后运行与文档 | 禁网/禁止命令/只读场景无越权调用；配置变化无旧连接复用；退出无残留自有进程；打包程序可加载所需运行时依赖 |

每阶段通过规定自动验收后，更新本计划状态，检查 git status/diff 与 diff --check，单独提交并推送当前分支，确认成功后才进入下一阶段。沿用当前分支，若另行建分支遵守仓库命名规则。不得跨越阶段检查点提前实现后续阶段。

测试使用隔离目录和本地可控 MCP 服务：stdio 与 Streamable HTTP 各一个确定性工具（如返回固定结构的 echo），验证模型调用携带参数、服务确实收到请求、返回值进入模型后续回答。分别记录原生执行端端到端测试与自有 SDK 测试，不以模拟适配器冒充端到端结果。

还需覆盖：不存在的命令、异常退出、握手失败、401/403、超时、JSON/SSE 响应、项目切换、配置更新、取消与服务清理。测试数量以发现这些真实失败为界，不扩展为压力测试项目。

所有构建和测试遵守前台 PowerShell `2>&1 | Tee-Object -FilePath "build.log"`，立即保存并检查 LASTEXITCODE；失败读取日志诊断。GUI 验证使用实际 Windows 窗口；涉及 Qt 时严格禁止 offscreen。人工项未执行记录 MANUAL/PENDING，不作为受阻条件，不冒记 PASS。

## 9. 当前状态与实施前核验

- 已完成：代码入口盘点、复用方案、作用域和默认来源规则、阶段与验收设计。
- M1：配置/来源/RPC 已实施；配置测试 3/3 PASS、tsc --noEmit PASS、git diff --check PASS。执行端及 GUI 尚未验证。
- M2 开始时核验：安装执行端的准确 schema/能力；Codex 合并及禁用语义；DSH/外接 ACP 的 HTTP 能力；Claude Desktop 官方文件位置；SDK 与当前 Node/Electron 的兼容性。
- 这些是相应阶段的首个验证任务，不预先扩展成新架构或额外兼容层。
- M1 检查点：534b377，已确认远端提交一致。
- M2：Claude/Codex/ACP/DSH 原生接入、权限与信任、SDK 诊断和 cwd helper 已实施。8/8 自动测试、类型检查、构建通过；Codex/Claude/DSH 各两种传输的新建及恢复会话真实调用通过。
- 下一步：完成 M2 提交与推送后进入 M3。

## 10. 官方参考

外部文档核对日期：2026-11-05。协议版本以实际 SDK 和执行端协商为准，不把指定参考版本当作最新版本承诺。

- [MCP transport 规范（2025-11-25）](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)：stdio / Streamable HTTP 的协议依据。
- [ACP Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)：会话 MCP 参数与 HTTP 能力协商。
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)：全局/项目来源格式与原生加载方式。
- [OpenAI MCP 配置说明](https://developers.openai.com/codex/mcp)：本地 TOML 来源与传输配置；云端连接器不从该文件推断。
