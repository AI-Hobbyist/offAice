# Agent Handoff

## 当前目标与阶段

按 docs/MCP支持计划.md 实施 M1–M4，各阶段验证、单独提交和推送；最后交付绿色版 ZIP。用户追加 AIROOM 配置独立保存、其他来源仅导入、自绘 MCP 图标、读取两级 AGENTS 且角色卡优先。

## 已完成与已验证

- M1：534b377 已推送。
- M2：a0e0821 已推送；Claude/Codex/DSH 两种传输新建/恢复真实模型调用 PASS。
- M3：744b642 已推送；自绘图标、全局/项目管理、真实 Windows UI 验证 PASS。
- M4 实现与验证完成，待提交推送：13/13 自动测试、类型检查、构建及候选打包 AIROOM.exe 真实窗口自动化 PASS；两级 AGENTS 的三个执行端真实模型角色优先测试 PASS；Codex 移除服务后 disabled/0 工具。
- 细节：docs/records/MCP实施记录.md；使用说明：docs/MCP与AGENTS使用说明.md。

## 尚未完成

M4 Git 检查点后，从干净源重新生成 release/AIROOM-0.1.0-Windows-x64-Green.zip；核验 ZIP/解压文件/最终真实窗口，记录最终回执与 SHA256，再更新本手册正常交付。现有 release/win-unpacked 是 sourceDirty=true 的候选，不能冒充最终发行包。

## Git 与环境

当前 main，push https://github.com/AI-Hobbyist/offAice.git。M4 修改保留待提交；已有 .codegraph/ 不提交、不删除。Node 26.13.0 已通过 nvm 安装，执行前前置 D:\node\nvm\v26.13.0。
所有构建测试前台 PowerShell Tee-Object build.log，立即捕获/检查退出码，不同时写同一日志。候选正常权限测试目录位于用户 LocalAppData/Temp/AIROOM-MCP-candidate-20261105；测试资料在 .test-cache 下，不打包。

## 约束和验证缺口

保持最小范围与已有用户修改；Qt 只能真实 Windows 窗口，禁止 offscreen；每阶段自动验收后提交推送才继续。人工项 MANUAL/PENDING，不作为 blocked。ZCode 无已核验接口，明确不支持；不能冒称全部外接执行端通过真实验证。额度可靠接口最近显示 usedPercent=6，未触发交接阈值。
