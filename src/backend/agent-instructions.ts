import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AdapterContext } from '../shared/types';

export const AGENT_INSTRUCTION_PRIORITY =
  '用户的明确指令优先；角色卡提示词完整保留并优先于 AGENTS。AGENTS 只补充工作约定，不得修改角色、称呼、风格、记忆或角色卡的其他要求。同类工作约定冲突时，项目 AGENTS 优先于全局 AGENTS。';

async function optionalInstructions(file: string): Promise<string> {
  try {
    return (await readFile(file, 'utf8')).replace(/^\uFEFF/, '').trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw new Error(`无法读取工作约定：${file}`);
  }
}

export async function loadAgentInstructions(
  projectDirectory?: string,
  home = homedir(),
): Promise<string> {
  const globalFile = path.join(home, '.airoom', 'AGENTS.md');
  const projectFile = projectDirectory ? path.join(projectDirectory, 'AGENTS.md') : undefined;
  const [global, project] = await Promise.all([
    optionalInstructions(globalFile),
    projectFile ? optionalInstructions(projectFile) : Promise.resolve(''),
  ]);
  const sections = [
    global ? `[全局工作约定：${globalFile}]\n${global}` : '',
    project ? `[项目工作约定：${projectFile}]\n${project}` : '',
  ].filter(Boolean);
  return sections.length
    ? `[AIROOM AGENTS 工作约定]\n以下为本轮完整 AGENTS 快照，只替换此前 AGENTS 条款，不清除角色卡或用户决定。\n${AGENT_INSTRUCTION_PRIORITY}\n\n${sections.join('\n\n')}\n\n[约定结束；角色卡继续有效]`
    : '';
}

export function instructionInput(ctx: AdapterContext, input: string): string {
  if (ctx.agentInstructions === undefined) return input;
  const current =
    ctx.agentInstructions ||
    `[AIROOM AGENTS 工作约定]\n当前没有全局或项目 AGENTS，不沿用此前 AGENTS 条款；角色卡和用户决定继续有效。\n${AGENT_INSTRUCTION_PRIORITY}`;
  return `${current}\n\n[当前用户消息]\n${input}`;
}

/** Keep persona untouched. Fresh/rebuilt room inputs need the same supplementary agreements. */
export async function prepareAgentInstructions(
  ctx: AdapterContext,
  projectDirectory?: string,
  home = homedir(),
) {
  ctx.agentInstructions = await loadAgentInstructions(projectDirectory, home);
  const fresh = ctx.freshInput;
  const refresh = ctx.refreshInput;
  if (fresh) ctx.freshInput = (canRemember) => instructionInput(ctx, fresh(canRemember));
  if (refresh) ctx.refreshInput = () => instructionInput(ctx, refresh());
}
