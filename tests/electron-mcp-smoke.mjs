import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { _electron as electron, expect } from '@playwright/test';
import { respond } from './fixtures/mcp-echo.mjs';
import { verifyMeetingApproval } from './fixtures/approval-window.mjs';

const root = process.cwd();
const results = path.join(root, '.test-cache', 'mcp-ui');
await mkdir(results, { recursive: true });
const directory = path.join(process.env.AIROOM_TEST_PROFILE, 'workspace');
await mkdir(directory, { recursive: true });
const server = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405);
    response.end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  const reply = respond(JSON.parse(body));
  response.writeHead(reply ? 200 : 202, reply ? { 'Content-Type': 'application/json' } : {});
  response.end(reply ? JSON.stringify(reply) : '');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const file = path.join(directory, 'import.json');
await writeFile(
  file,
  JSON.stringify({
    mcpServers: {
      remote_echo: { type: 'http', url: `http://127.0.0.1:${server.address().port}/mcp` },
    },
  }),
);
const env = { ...process.env };
const nvmRoot = path.join(process.env.AIROOM_TEST_PROFILE, 'nvm');
const commandDirectory = path.join(nvmRoot, 'v22.0.0');
await mkdir(commandDirectory, { recursive: true });
await copyFile(
  path.join(root, 'tests', 'fixtures', 'mcp-echo.mjs'),
  path.join(commandDirectory, 'echo.mjs'),
);
await writeFile(path.join(commandDirectory, 'mcp-ui-echo.cmd'), '@"%dp0%\\echo.mjs" %*');
env.NVM_HOME = nvmRoot;
delete env.ELECTRON_RUN_AS_NODE;
const launchOptions = {
  executablePath: env.AIROOM_ELECTRON_EXE,
  args: [env.AIROOM_SMOKE_APP_ROOT || root],
  env,
  timeout: 60000,
};
let app = await electron.launch(launchOptions);
let page;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '设置与连接', exact: true }).waitFor();
  await page.waitForFunction(() => Boolean(window.airoom));
  await page.evaluate(() => window.airoom.invoke('snapshot'));
  const project = await page.evaluate(
    async (directory) =>
      window.airoom.invoke('project.create', { name: 'MCP 验证项目', directory }),
    directory,
  );
  await page.evaluate(async (projectId) => {
    const member = await window.airoom.invoke('team.save', {
      member: { name: 'MCP 验证成员', executor: 'codex' },
    });
    await window.airoom.invoke('project.update', { projectId, memberIds: [member.id] });
  }, project.id);
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  const introduction = '我是开发者，主要使用中文交流。PROFILE_UI_MARKER';
  await page.getByLabel('自我介绍', { exact: true }).fill(introduction);
  await page.getByRole('button', { name: '连接与版本', exact: true }).click();
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  await expect(page.getByLabel('自我介绍', { exact: true })).toHaveValue(introduction);
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page
    .getByRole('dialog', { name: '设置与成员连接', exact: true })
    .waitFor({ state: 'hidden' });
  await app.close();
  app = await electron.launch(launchOptions);
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '设置与连接', exact: true }).waitFor();
  await page.evaluate(() => window.airoom.invoke('snapshot'));
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  await expect(page.getByLabel('自我介绍', { exact: true })).toHaveValue(introduction);
  await page.getByRole('dialog').evaluate(async (node) => {
    await Promise.all(
      node.parentElement
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    );
  });
  await page.screenshot({ path: path.join(results, 'profile-introduction.png') });
  await page.getByRole('button', { name: 'MCP 工具', exact: true }).click();
  const panel = page.getByRole('region', { name: 'MCP 配置', exact: true });
  await panel.getByLabel('默认 MCP 导入来源', { exact: true }).selectOption('file');
  await panel.getByLabel('MCP 导入文件路径', { exact: true }).fill(file);
  await panel.getByRole('button', { name: '预览导入', exact: true }).click();
  await panel.getByRole('button', { name: '取消预览', exact: true }).click();
  assert.equal(await panel.getByRole('article', { name: 'MCP 服务 remote_echo' }).count(), 0);
  await panel.getByRole('button', { name: '预览导入', exact: true }).click();
  await panel.getByRole('button', { name: '应用导入', exact: true }).click();
  const remote = panel.getByRole('article', { name: 'MCP 服务 remote_echo', exact: true });
  await remote.waitFor();
  await remote.getByRole('button', { name: '测试连接', exact: true }).click();
  await remote.getByText('连接成功 · 1 个工具', { exact: false }).waitFor();

  await panel.getByRole('button', { name: '添加服务', exact: true }).click();
  await panel.getByLabel('MCP 服务名称', { exact: true }).fill('local_echo');
  await panel.getByLabel('MCP 启动命令', { exact: true }).fill('mcp-ui-echo');
  await panel.getByLabel('MCP 参数', { exact: true }).fill(JSON.stringify(['--stdio']));
  await panel
    .getByLabel('MCP 环境变量', { exact: true })
    .fill(JSON.stringify({ TEST_TOKEN: 'mcp-ui-private-123456' }));
  await panel.getByRole('button', { name: '保存服务', exact: true }).click();
  const local = panel.getByRole('article', { name: 'MCP 服务 local_echo', exact: true });
  await local.waitFor();
  await local.getByRole('button', { name: '编辑', exact: true }).click();
  assert.ok(
    !(await panel.getByLabel('MCP 环境变量', { exact: true }).inputValue()).includes(
      'mcp-ui-private-123456',
    ),
  );
  await panel.getByRole('button', { name: '保存服务', exact: true }).click();
  await local.getByRole('button', { name: '测试连接', exact: true }).click();
  await local.getByText('连接成功 · 1 个工具', { exact: false }).waitFor();

  await panel.getByLabel('MCP 配置范围', { exact: true }).selectOption(project.id);
  await panel.getByLabel('启用 remote_echo', { exact: true }).click();
  await panel.getByText('已禁用，屏蔽同名继承服务', { exact: false }).waitFor();
  await panel.getByLabel('MCP 配置范围', { exact: true }).selectOption('global');
  await panel.getByLabel('启用 remote_echo', { exact: true }).check();
  await panel.getByLabel('默认 MCP 导入来源', { exact: true }).selectOption('app');
  await remote.waitFor();
  assert.equal(await panel.getByLabel('启用 remote_echo', { exact: true }).isChecked(), true);
  assert.equal(await remote.getByText('连接成功 · 1 个工具', { exact: false }).count(), 1);

  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      bounds: window.getBounds(),
    })),
  );
  assert.ok(windows.some((window) => window.visible && window.bounds.width > 600));
  const packaged = await app.evaluate(({ app }) => app.isPackaged);
  if (process.env.AIROOM_REQUIRE_PACKAGED === '1') assert.equal(packaged, true);
  await page.screenshot({ path: path.join(results, 'mcp-settings.png') });
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page
    .getByRole('treeitem')
    .filter({ hasText: 'MCP 验证项目' })
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'MCP 配置…', exact: true }).click();
  await page.getByText('已禁用，屏蔽同名继承服务', { exact: false }).waitFor();
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('treeitem').filter({ hasText: 'MCP 验证项目' }).first().click();
  const meetingMcp = page.getByRole('button', { name: '允许本会议使用 MCP', exact: true });
  await meetingMcp.waitFor();
  assert.equal(await meetingMcp.getAttribute('aria-pressed'), 'false');
  await meetingMcp.click();
  await page.getByText('MCP 已授权', { exact: true }).waitFor();
  assert.equal(await meetingMcp.getAttribute('aria-pressed'), 'true');
  await page.getByText('原生工具只读；已授权的外部 MCP 可独立执行操作', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(results, 'mcp-meeting.png') });
  await meetingMcp.click();
  await page.getByText('MCP 未授权', { exact: true }).waitFor();
  const accessMode = page.getByLabel('对话访问模式', { exact: true });
  for (const mode of ['ask', 'auto', 'full']) {
    await accessMode.selectOption(mode);
    await expect(accessMode).toHaveValue(mode);
  }
  await page.screenshot({ path: path.join(results, 'meeting-access.png') });
  await page.evaluate(async () => {
    const snapshot = await window.airoom.invoke('snapshot');
    await window.airoom.invoke('desk.topic', { memberId: snapshot.members[0].id });
  });
  await page.getByRole('button', { name: 'MCP 验证成员 的工位', exact: true }).click();
  for (const mode of ['ask', 'auto', 'full']) {
    await accessMode.selectOption(mode);
    await expect(accessMode).toHaveValue(mode);
  }
  await page.screenshot({ path: path.join(results, 'desk-access.png') });
  await verifyMeetingApproval(app, page, project, results);
  assert.deepEqual(errors, []);
  const snapshot = await page.evaluate(() => window.airoom.invoke('mcp.list', { scope: 'global' }));
  assert.ok(!JSON.stringify(snapshot).includes('mcp-ui-private-123456'));
  await writeFile(
    path.join(results, 'receipt.json'),
    JSON.stringify(
      {
        status: 'passed',
        realWindows: windows,
        packaged,
        covered: [
          'import-preview-cancel',
          'import-apply',
          'edit-redaction',
          'stdio-test',
          'http-test',
          'project-override',
          'source-switch-preserves-config',
          'test-result-persistence',
          'project-direct-entry',
          'meeting-mcp-authorize-revoke',
          'meeting-approval-dialog-answer-reopen',
          'conversation-access-modes',
          'profile-introduction-save-reopen',
          'profile-footer-save-full-process-restart',
        ],
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log('Real Windows MCP UI PASS:', results);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
