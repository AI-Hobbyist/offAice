# MCP 实施验证记录

## M1 — 2026-11-05

- 配置：全局/项目、整条覆盖、禁用标记、来源快照、默认来源继承。
- 来源：Codex TOML、Claude Code 用户/项目/local、Desktop/ChatGPT 导出/自定义文件。
- 安全：完整配置 AES-256-GCM 加密保存；密钥由 Electron safeStorage 保护；预览与读取隐藏 env/header/参数值；原配置只读。
- `node --import tsx --test tests/mcp-config.test.ts`：3/3 PASS。
- `tsc --noEmit`：PASS；`git diff --check`：PASS。
- 测试覆盖：覆盖/恢复继承、项目隔离、保留名称、无效传输、加密持久化、脱敏、预览/应用、错误无写入、预览过期、来源切换、TOML、Claude local 优先级。
- 构建运行时：nvm 已安装 Node.js 26.13.0。为避免宿主工具 PATH 覆盖，验证时显式前置该版本路径。
- 没有运行外部 MCP 服务，M2/M3/M4 尚未实施；不将配置测试记作真实模型端到端验证。
- 当前任务已获用户授权按阶段提交/推送。M1 检查点完成后才进入 M2。

## M2 — 2026-11-05

- M1 已提交/推送：534b377848e7a053dd1540a3b00a4bdefa4bb4b1，已核对远端 main。
- Claude、Codex、ACP、DSH 复用原生入口；HTTP 检查 ACP 能力；探测保持空配置；ZCode 无已核验原生接口时明确报不支持，不静默忽略。
- SDK 2.0.0 为直接运行依赖；测试连接只初始化/listTools；stdio 使用现有 Windows Job guardian；cwd helper 支持原生协议缺少的 cwd 字段。
- 只读、禁网、禁止命令、工作区范围和普通聊天不启动外部服务；项目首次启用复用提问审批并保存配置指纹。
- 已复现 Codex 深合并 env={} 仍保留旧值；修复为禁用继承服务，同名冲突使用独立别名。隔离真实 app-server 测试确认旧服务未启动、旧 env 未继承。
- 全套自动测试：8/8 PASS；tsc --noEmit PASS；生产构建 PASS；git diff --check PASS。格式化限定在 MCP 模块和测试。
- 实际模型调用：Codex、Claude、DSH 各 stdio/HTTP；各自新建与恢复会话均 PASS。每次核对服务端收参和模型返回中的服务端值，不是模拟模型。
- 回执目录：.test-cache/mcp-codex-1793881020718、mcp-claude-1793881091975、mcp-dsh-1793881123738（测试缓存不提交/不打包）。
- SDK HTTP 测试还覆盖 JSON/SSE 响应、401 和启动超时；本机 loopback 在受限环境被拦，已在正常权限环境完成验证。
- 用户补充：AIROOM 独立保存自己的 MCP 配置，其他仅用于导入；默认导入来源切换不删除/禁用已保存服务。对应测试已更新并通过。
- 下一阶段 M3 包含用户要求的自绘 SVG 图标。M3/M4 尚未实施。

## M3 — 2026-11-05

- M2 已提交/推送：a0e08216a476debadb4e881c2db9ead243a61270，已核对远端 main。
- 全局设置 MCP 页、项目菜单及项目会议室入口；自绘 SVG 连接图标；导入预览/取消/应用、编辑、启用禁用、恢复继承、测试连接、兼容状态。
- 测试结果独立保存，按服务配置指纹失效；密钥/参数回读仍脱敏。
- `node scripts/build.mjs`、`tsc --noEmit`：PASS。
- `node --import tsx scripts/desktop-smoke.mjs tests/electron-mcp-smoke.mjs`：真实 Windows 可见窗口 PASS。覆盖导入预览/取消/应用、编辑脱敏、stdio/HTTP 连接、项目禁用覆盖、来源切换保留服务、测试结果持久化、项目菜单直接入口。
- 已检视 .test-cache/mcp-ui/mcp-settings.png：中文正常，无 tofu；布局与自绘图标正常。回执 .test-cache/mcp-ui/receipt.json 记录窗口 visible=true，1480×970。
- 补齐锁定版本 Electron 官方二进制后完成测试；测试等待正式 snapshot 就绪，不使用固定启动延时。退出改用正常 app.close，避免强退遗留后端。
- 测试使用临时复制的生产依赖和独立、退出登录资料目录；没有修改用户日常配置。隔离测试缓存保留用于验证，不打包。
- 用户新授权：M4 读取用户 .airoom/AGENTS.md 与项目 AGENTS.md，角色卡保持独立且优先。

## M4 — 2026-11-05

- M3 已提交/推送：744b6425661a34b8ad7dc994dbbbc0feb534022f，已核对远端 main。
- 两级 AGENTS：用户 .airoom/AGENTS.md 与项目根 AGENTS.md；每轮完整快照，缺失/移除不沿用旧 AGENTS，角色卡保持独立和优先，运行时指纹覆盖变化。
- 实际模型冲突验证：Codex/Claude/DSH 均返回角色卡身份和两级约定标记，没有采用 AGENTS 的冲突身份。回执 .test-cache/agents-model-1793882210801/receipt.json。
- Codex 关闭隐式 codex_apps；受管理服务使用配置相关的独立名称，会话保存并显式禁用先前名称，禁用条目仍符合原生传输 schema。真实 stdio/HTTP 配置移除后清单均显示 disabled、tools=0；回执 .test-cache/mcp-codex-1793882828731/receipt.json。
- JSON 同层重复键不再静默覆盖；无效根节点明确报错。新增 jsonc-parser 直接运行依赖用于语法树检查。
- 13/13 自动测试 PASS；tsc --noEmit PASS；生产构建 PASS。覆盖错误导入原子性、项目隔离、凭据脱敏、显式信任、配置/凭据变化失效、权限过滤、401/403、超时、命令缺失、异常退出、取消、真实子进程树清理、原生配置隔离以及两级 AGENTS。
- 候选目录通过 electron-builder 构建，171 个生产依赖清单验证。正常 Windows 临时目录内运行真正 AIROOM.exe，app.isPackaged=true、visible=true；完整 MCP UI 自动化 PASS。回执 .test-cache/mcp-ui/receipt.json，截图中文与布局正常。
- 此候选目录用于阶段验收，manifest.sourceDirty=true，不作为最终交付。最终 ZIP 必须在本阶段提交/推送后重新从干净源生成。
- 使用说明：docs/MCP与AGENTS使用说明.md。未扩展 ZCode 架构；其未核验接口状态明确显示，不宣称支持。
- 人工验收：MANUAL/PENDING（可自主验证均已完成，不作为任务受阻条件）。

## 最终绿色版交付 — 2026-11-05

- M4 已提交/推送：bf733bde157cf88b0131b5cf012916c315d68073；已核对远端 main。
- `npm run package:green`：PASS。从干净源重新构建，sourceDirty=false。
- ZIP：release/AIROOM-0.1.0-Windows-x64-Green.zip；172646527 字节（约 164.6 MiB）。
- SHA256：`d6f443a97f740862808d03731b2b4b743dbd35ecc0c97418394fb50e267f90f5`；对应 .zip.sha256 文件已生成，独立重算匹配。
- 压缩完整性 PASS，7560 个解压文件哈希一致，171 个生产依赖验证通过。没有打包用户资料、密钥、模型 CLI 或测试数据。
- 直接运行最终 ZIP 校验解压出的 AIROOM.exe：真实 Windows 可见窗口、app.isPackaged=true；全局/项目配置、导入、编辑脱敏、两种连接、持久化结果和项目菜单入口再次 PASS。
- 最终回执：release/green-receipt.json，desktopAcceptance=passed；UI 回执 .test-cache/mcp-ui/receipt.json；已检视最终截图，中文正常无方框。
- Windows 签名状态：NotSigned；未声明有受信任代码签名。人工使用验收 MANUAL/PENDING。
- 无剩余实施工作。后续改动应另行定义范围；现有 .codegraph/ 保留不提交。
