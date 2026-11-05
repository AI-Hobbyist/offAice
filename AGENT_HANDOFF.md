# Agent Handoff

当前目标：按 docs/MCP支持计划.md 完成 M1–M4，严格每阶段验证、单独提交并推送；最终打包绿色版 ZIP。

M1 已完成：534b377，已推送并核对远端。M2 已完成并推送 a0e0821；8/8 自动测试与 Claude/Codex/DSH 两种传输新建/恢复真实调用 PASS。M3 界面、自绘 SVG、真实窗口自动化、类型检查和构建 PASS，待本阶段 Git 检查点。验证见 docs/records/MCP实施记录.md。
M4 未开始；用户追加两级 AGENTS：%USERPROFILE%/.airoom/AGENTS.md 和项目根 AGENTS.md，不能覆盖角色卡提示词。用户最新要求：AIROOM 配置独立保存，其他产品仅用于导入；已调整默认导入来源切换不影响已保存服务。
当前 main，push 为 https://github.com/AI-Hobbyist/offAice.git；已有未跟踪 .codegraph/ 保留不提交。M3 改动尚未提交时必须保留，不能重做 M1/M2。
下一步：M3 提交推送确认后开始 M4 两级 AGENTS、回归和打包；最终 ZIP 需 sourceDirty=false、依赖和解压校验、正常 Windows 启动验证。不能将阶段完成当作整个目标完成。
Node 26.13.0 已通过 nvm 安装。执行前将 D:\node\nvm\v26.13.0 前置 PATH；构建/测试严格前台 PowerShell Tee-Object build.log，立即保存/检查退出码；不要同时写同一 build.log。
GUI 使用真实 Windows 窗口，Qt 禁止 offscreen；人工未验记录 MANUAL/PENDING，不作为受阻。额度接口最近显示周池 usedPercent=6，无交接阈值触发。
