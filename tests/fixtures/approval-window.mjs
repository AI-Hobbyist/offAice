import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Real renderer/window, with a deterministic pending-approval snapshot and no model/account access. */
export async function verifyMeetingApproval(app, page, project, results) {
  const data = await page.evaluate(
    async (projectId) => ({
      snapshot: await window.airoom.invoke('snapshot'),
      room: await window.airoom.invoke('room.get', { roomId: `project:${projectId}` }),
      flow: await window.airoom.invoke('projectFlow.get', { projectId }),
    }),
    project.id,
  );
  const member = data.snapshot.members[0];
  const session = {
    id: 'approval-fixture-session',
    projectId: project.id,
    provider: 'codex',
    memberId: member.id,
    roomId: `project:${project.id}`,
    roomThreadId: data.room.currentThreadId,
    revision: 1,
    title: '会议审批验证',
    writeMode: false,
  };
  data.snapshot.sessions.push(session);
  data.snapshot.runs.push({
    id: 'approval-fixture-run',
    sessionId: session.id,
    projectId: project.id,
    provider: 'codex',
    revision: 1,
    status: 'waiting_user',
    createdAt: new Date().toISOString(),
  });
  data.snapshot.sync = { epoch: 'approval-window', revision: 1 };
  const approval = {
    id: 'meeting-trust',
    runId: 'approval-fixture-run',
    sessionId: session.id,
    provider: 'codex',
    type: 'question',
    title: '确认本项目的 MCP 服务',
    detail: '外部 MCP 以当前账号权限运行：codegraph',
    options: [
      { id: 'allow', label: '信任并启用' },
      { id: 'deny', label: '取消本轮' },
    ],
    state: 'pending',
    createdAt: new Date().toISOString(),
  };
  const preload = path.join(process.env.AIROOM_TEST_PROFILE, 'approval-preload.cjs');
  await writeFile(
    preload,
    `
const {contextBridge}=require('electron');
const data=${JSON.stringify(data)}, approval=${JSON.stringify(approval)};
const listeners=new Set(), answers=[];
function pending(value){
  data.snapshot.approvals=[value];
  data.snapshot.attention={total:1,counts:{question:1},items:[{
    id:'question:'+value.id,kind:'question',title:'成员 等你回答',detail:value.detail,
    at:value.createdAt,approvalId:value.id,sessionId:value.sessionId,projectId:${JSON.stringify(project.id)},
    roomId:${JSON.stringify(session.roomId)},action:{view:'project-room',label:'回答问题'}
  }]};
}
function publish(){data.snapshot.sync.revision++;for(const listener of listeners)listener({type:'snapshot',snapshot:data.snapshot});}
pending(approval);
contextBridge.exposeInMainWorld('airoom',{
  onEvent(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  async invoke(method,params){
    if(method==='snapshot')return data.snapshot;
    if(method==='room.get')return data.room;
    if(method==='projectFlow.get')return data.flow;
    if(method==='projectFlow.memberReports')return {members:[]};
    if(method==='approval.answer'){
      answers.push(params);data.snapshot.approvals[0].state='answered';
      data.snapshot.attention={total:0,counts:{},items:[]};publish();return {answered:true};
    }
    if(method==='fixture.answers')return answers;
    if(method==='fixture.question'){
      pending({...approval,state:'pending',id:'member-question',title:'选择检查范围',questions:[{
        id:'scope',question:'检查哪个范围？',options:[{label:'当前项目'},{label:'整个目录'}]
      }],options:[{id:'answer',label:'提交回答'},{id:'cancel',label:'取消'}]});publish();return;
    }
    return {};
  }
});`,
  );
  const appRoot = process.env.AIROOM_SMOKE_APP_ROOT || process.cwd();
  const windowPromise = app.waitForEvent('window');
  const id = await app.evaluate(
    async ({ BrowserWindow }, { preload, file }) => {
      const window = new BrowserWindow({
        width: 1480,
        height: 970,
        show: true,
        webPreferences: { preload, contextIsolation: true, sandbox: false },
      });
      await window.loadFile(file);
      return window.id;
    },
    { preload, file: path.join(appRoot, 'dist', 'renderer', 'index.html') },
  );
  const fixture = await windowPromise;
  try {
    await fixture.getByRole('treeitem').filter({ hasText: project.name }).first().click();
    const dialog = fixture.getByRole('dialog', { name: '确认本项目的 MCP 服务', exact: true });
    await dialog.waitFor({ timeout: 5000 });
    await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await fixture.getByRole('button', { name: /待你处理/ }).click();
    await fixture.getByRole('button', { name: '回答问题', exact: true }).click();
    await dialog.waitFor();
    await dialog.evaluate(async (node) => {
      await Promise.all(
        node.parentElement
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      );
    });
    await fixture.screenshot({ path: path.join(results, 'meeting-approval.png') });
    await dialog.getByRole('button', { name: '信任并启用', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      (await fixture.evaluate(() => window.airoom.invoke('fixture.answers')))[0].choice,
      'allow',
    );
    await fixture.evaluate(() => window.airoom.invoke('fixture.question'));
    const question = fixture.getByRole('dialog', { name: '选择检查范围', exact: true });
    await question.getByRole('radio', { name: '当前项目', exact: true }).check();
    await question.getByRole('button', { name: '提交回答', exact: true }).click();
    await question.waitFor({ state: 'hidden' });
    const answers = await fixture.evaluate(() => window.airoom.invoke('fixture.answers'));
    assert.equal(answers[1].answers.scope, '当前项目');
  } finally {
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), id);
  }
}
