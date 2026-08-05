export type AiStatusKind = 'working' | 'warn' | 'error' | 'ok' | '';

let text = '';
let kind: AiStatusKind = '';

export function setAiStatus(t: string, k: AiStatusKind = ''): void {
  text = t;
  kind = k;
  refreshEl();
}

export function refreshEl(): void {
  const el = document.getElementById('statusbar-ai');
  if (!el) return;
  const cls = 'statusbar-ai' + (kind ? ` ${kind}` : '');
  if (el.textContent === text && el.className === cls) return;
  el.textContent = text;
  el.className = cls;
}
