export type AccessMode = 'ask' | 'auto' | 'full';

export const ACCESS_MODES = [
  { id: 'ask', label: '请求批准', detail: '需要额外权限的文件和命令操作逐次请求批准。' },
  { id: 'auto', label: '帮我批准', detail: '工作目录内自动工作；需要越界或扩展权限时仍询问。' },
  { id: 'full', label: '完全访问', detail: '不使用文件沙箱，操作审批自动批准；问题仍由你回答。' },
] as const;

export function isAccessMode(value: unknown): value is AccessMode {
  return ACCESS_MODES.some((mode) => mode.id === value);
}
