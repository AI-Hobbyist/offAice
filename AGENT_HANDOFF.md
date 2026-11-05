# Agent Handoff

最新任务：项目会议审批交互对话框修复已完成并推送。当前绿色包与验证以文末“项目会议审批无法交互”记录为准，之前交付均是历史版本。最终文档提交以 git log 为准。

## 当前任务最终状态

MCP 支持计划 M1–M4 已完成，按顺序每阶段验证、单独提交并推送。绿色 ZIP 已生成并通过最终解压程序的真实 Windows 窗口验收。无剩余实施任务，无实际阻碍；人工验收 MANUAL/PENDING。

## 提交与推送

当前分支 main；push https://github.com/AI-Hobbyist/offAice.git，fetch 保留原地址。
M1 534b377、M2 a0e0821、M3 744b642、M4 bf733bd 均已推送并核对远端。最终交付文档由收尾提交保存；具体文档提交以 git log 为准。已有未跟踪 .codegraph/ 保留，不提交、不删除。

## 已完成

- 全局/项目 MCP 配置、覆盖/禁用、独立加密保存。其他产品配置仅导入，默认导入来源切换不改变已保存服务。
- stdio/Streamable HTTP 原生执行接入及 SDK 连接测试；显式信任、权限过滤、运行时失效与进程清理；自绘 SVG 及全局/项目界面。
- 用户 %USERPROFILE%/.airoom/AGENTS.md 与项目根 AGENTS.md，角色卡独立且优先；每轮工作约定快照。

## 已验证

13/13 自动测试、类型检查、生产构建 PASS。Claude/Codex/DSH 两种传输新建/恢复真实模型调用 PASS；三执行端两级 AGENTS 与角色卡冲突测试 PASS。Codex 配置移除后的原生清单 disabled/0 工具，隐式 apps 保持关闭。真实 stdio 子进程树清理 PASS。
最终 ZIP 源提交 bf733bde157cf88b0131b5cf012916c315d68073，sourceDirty=false，完整性 PASS、7560 个解压文件哈希一致、171 个生产依赖验证通过。直接运行最终解压 AIROOM.exe，app.isPackaged=true、visible=true，MCP UI 自动化 PASS，中文无方框。

## 交付物和记录

- release/AIROOM-0.1.0-Windows-x64-Green.zip
- SHA256：d6f443a97f740862808d03731b2b4b743dbd35ecc0c97418394fb50e267f90f5
- release/green-receipt.json；.zip.sha256；.test-cache/mcp-ui/receipt.json
- docs/MCP支持计划.md；docs/records/MCP实施记录.md；docs/MCP与AGENTS使用说明.md

## 边界与约束

ZCode 暂不支持，其他 ACP 的 HTTP 需声明能力；旧 HTTP+SSE 不在本期；ChatGPT 云端配置仅接受导出/手工地址。签名 NotSigned，未声明可信签名。人工未验记 MANUAL/PENDING，不作为 blocked。
后续保持最小范围与现有用户改动；Qt 只能真实 Windows 窗口，严禁 offscreen；构建/测试前台 PowerShell Tee-Object build.log 并立即检查退出码。Node 26.13.0 已由 nvm 安装启用；D:/node/nodejs/node.exe 已核对版本。额度可靠接口最近 usedPercent=7，未触发额度交接。

## 2026-11-05：CodeGraph 连接诊断（已完成）

用户截图报 .cmd 非 npm shim。已用 AIROOM 的 resolveAcpProgram("codegraph") 复现同一错误：本机 PATH 指向 C:/Users/eryth/AppData/Local/codegraph/current/bin/codegraph.cmd，实际内容使用自带 node.exe、--liftoff-only 和 ../lib/dist/bin/codegraph.js；不符合现有仅支持 npm shim 的解析格式。

已用同一 connectMcp 连接层验证可用配置：
- command：C:/Users/eryth/AppData/Local/codegraph/current/node.exe
- args：["--liftoff-only", "C:/Users/eryth/AppData/Local/codegraph/current/lib/dist/bin/codegraph.js", "serve", "--mcp"]
- cwd：D:/UserData/Desktop/Project/offAice
- 结果：connected，1 个工具 codegraph_explore；连接已关闭，无模型请求。

本轮只诊断并提供可用填写方式，未修改程序代码或既有绿色 ZIP；本手册更新未提交。原 MCP M1–M4 交付状态保持有效。没有剩余诊断工作；兼容该自定义启动脚本的代码改动未纳入本轮范围。

## 2026-11-05：Minecraft Dev MCP 添加方式（已验证）

本机已安装 @mcdxai/minecraft-dev-mcp 1.3.0，位于 nvm 的 v22.22.2 全局包目录；当前 Node 26 的 PATH 找不到旧版本目录中的 minecraft-dev-mcp。
可用 command：D:/node/nvm/v22.22.2/node.exe
可用 args：["D:/node/nvm/v22.22.2/node_modules/@mcdxai/minecraft-dev-mcp/dist/index.js"]
已通过 AIROOM 同一 connectMcp 连接层完成初始化/listTools，connected，21 个工具；连接已关闭，无模型调用或游戏启动。验证使用工作区 .test-cache/minecraft-mcp-check 隔离缓存，未改用户原缓存；填写时可使用默认环境变量 {}。
本轮未修改代码、安装包或系统 Node 版本；仅补充此诊断记录，未提交。

## 2026-11-05：MCP 直接输入命令名称（实施完成）

根因：连接测试复用了过窄的 ACP 启动器解析，而默认工作目录的正式执行直接转发原始命令；均未覆盖 CodeGraph 自带 Node 启动器与 nvm 旧版本全局安装目录。

新增 MCP 专用统一解析器，连接测试/正式执行共同使用；查找项目本地命令、PATH、npm 全局目录、nvm 已安装版本，解析 npm 和单行 Node 转发器，保留匹配的 Node 与参数。参数不经过命令解释器。界面示例和使用说明同步更新。未修改其他应用配置，未新增自动安装功能。

验证：16/16 回归测试、tsc、生产构建 PASS；真实 Windows 窗口添加裸命令 mcp-ui-echo 并连接 PASS（隔离 nvm、无外置 Node，使用应用运行时）。实际 codegraph / minecraft-dev-mcp 裸命令经诊断与正式执行映射均连接成功，分别 1/21 工具；只读取工具清单。截图中文正常。使用 formatter 的首次本地路径不存在，改用 npm 缓存的 prettier 后 PASS。

当前 main；修复提交 0113b966e50bf83f052c78c64cedcd20752ed111 已推送 origin/main。新版绿色包已完成，源工作区干净；最终解压 AIROOM.exe 的真实 Windows MCP UI PASS，packaged=true，visible=true，中文正常。7560 个文件哈希与 171 个依赖校验通过。新版 ZIP SHA256 fdb340a7664472cd936d3506d99caf12afcc02624e2a3616e6d965473240f9e3，大小 172646596 字节。路径 release/AIROOM-0.1.0-Windows-x64-Green.zip；旧包/摘要/收据已保存为 release/pre-command-fix-*。无剩余实施，无实际阻碍；用户人工验收 MANUAL/PENDING。

## 2026-11-05：项目会议聊天未看到 MCP（诊断完成）

用户截图位于项目会议聊天，显示只读项目访问。已检查 mcpRestriction/executableServers 和 McpService.prepare：room 或 room-* 会话被明确关闭外部 MCP；只读会话另有独立限制。用真实函数复现：配置 1 个启用的 codegraph，reason=此聊天场景不开放外部 MCP。，injected=0。根因是既有场景/权限策略，不是命令查找或测试连接失败。

未修改生产代码、用户配置或绿色包。若开放会议聊天 MCP，须改变现有只读权限边界（外部 MCP 不受模型沙箱限制），需用户确认选择。可选范围：仅展示配置/禁用原因，或显式授权会议调用外部 MCP。未取得授权前不解除限制。本次诊断不需要 GUI 验收；实际模型工具调用未执行。当前 main，修复与绿色包仍为前一条记录，只有本手册追加诊断未提交；.codegraph/ 保留。无已授权的剩余实施项。

## 2026-11-05：开放项目会议 MCP（用户已授权，实施验证完成）

用户明确回复“开放”，同意为项目会议增加外部 MCP 显式授权。新增当前会议的授权/撤销开关，默认关闭；普通发言和 @ 回复可使用，原生工具仍只读，联网禁用与服务信任确认继续生效。举手、纪要、图片和压缩辅助轮次不获授权。撤销/切换时清理本会议运行时，指纹包含授权位。修正会议内部项目错误作为 MCP 来源，改为绑定真实项目的全局+项目配置。Claude 普通发言移除外部 MCP 全禁用并按已授权服务开放，原生工具保持只读。Qoder 保留原生工具关闭和严格 MCP 配置，只传 AIROOM 的服务。

17/17 自动回归、tsc、生产构建 PASS。Engine 真实上下文测试覆盖项目覆盖全局、显式确认、开启/撤销、只读命令限制保持、禁网、辅助轮次禁用和真实 SDK 工具调用。Codex、Claude 用隔离官方账号目录在 readonly/commands-deny/workspace 条件下完成 model -> stdio MCP -> model，服务随机 nonce 回传 PASS。真实 Windows 窗口授权/撤销 PASS，中文正常。初次 UI 测试缺少进入项目步骤及参会成员，修正隔离测试数据/导航后 PASS；未通过轮次未计为通过。其他 ACP/DSH 会议模型调用本轮未验证，通用配置映射已覆盖。

用户询问 OMP 项目独立配置：用真实 readMcpSource 只读检查 D:/UserData/Desktop/Project/OMP/OMP_26.1.2/.codex/config.toml，识别 minecraft-dev，stdio，enabled=true，issues=[]。已说明项目范围选 OMP、来源 Codex、预览/应用导入；未修改原文件或用户 AIROOM 数据。继续遵循其他产品配置仅用于导入的约定。

当前 main；实施提交 88cc2473d7c43811be91c0ba09d9d509acba2d1e 已推送 origin/main。新版绿色包源提交为该提交，sourceDirty=false；release/AIROOM-0.1.0-Windows-x64-Green.zip，172647593 字节，SHA256 54d2337e8aaac382346ce52309e4322134c8bd221dbea1624dba73687febd825。7560 个解压文件哈希一致，171 个生产依赖校验 PASS；最终解压 AIROOM.exe 的真实 Windows MCP UI 授权/撤销及 stdio/HTTP 测试 PASS，packaged=true、visible=true，中文正常。旧包/摘要/收据保存为 release/pre-meeting-mcp-*。签名 NotSigned。无剩余实施，无实际阻碍；用户人工验收 MANUAL/PENDING。额度接口 usedPercent=9，未触发交接。

## 2026-11-05：项目会议审批无法交互（修复已验证）

根因：项目会议没有 ApprovalCard，而待处理入口仅导航回会议；MCP 信任请求虽已挂起并进入 attention，用户没有可提交答案的界面。修复在 App 复用现有 Modal/ApprovalCard：当前项目会议的 pending 审批自动弹出，关闭仅暂时收起；attention 的 approvalId 可重新打开。按请求 ID 重置答案和焦点；回答/过期后关闭，不自动批准。

真实窗口回归先运行已发布 88cc247 程序，等待 MCP 确认对话框 5 秒超时（RED）。修复后真实 Windows 窗口 PASS：自动弹出、关闭、待处理重开、信任并启用提交 allow、结构化问题选择和答案提交。新增 fixtures/approval-window.mjs 用固定 snapshot 和独立 preload 驱动真实生产 renderer，不连接真实账号、不调用模型，不冒称后端端到端验证。初次结构化问题 fixture 继承了 answered 状态，修正为 pending 后 PASS。原有 MCP 设置 stdio/HTTP 真实连接与会议授权/撤销一并 PASS。tsc、生产构建 PASS。最终包还将等待动画稳定后检查截图。

本轮只修改 renderer 审批入口、UI 测试与说明，不改变后端信任/审批规则。当前 main，修复提交 9e7255f9063af6b42db031e83bc2eda6c5d83e63 已推送。绿色包 release/AIROOM-0.1.0-Windows-x64-Green.zip，源提交为该提交，sourceDirty=false；172647824 字节，SHA256 ecfcc50007429e92558d75fd8cc6bd4807eda21bba26aa82d7a8c240b2b1e8cf。最终解压 AIROOM.exe 实际窗口验收 PASS，packaged=true、visible=true；审批固定数据回归 PASS，动画完成后截图中文/布局正常。7560 个文件哈希一致，171 个生产依赖校验通过。旧包/摘要/收据保存为 release/pre-approval-dialog-*。签名 NotSigned，本轮没有真实模型调用；之前后端/模型验证仍为历史记录。用户人工验收 MANUAL/PENDING，无剩余实施，无实际阻碍。额度接口 usedPercent=9，未触发交接。
