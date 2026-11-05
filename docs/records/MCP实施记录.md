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
