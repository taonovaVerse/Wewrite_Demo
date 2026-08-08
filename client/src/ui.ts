/** SVG 元素命名空间（手写 SVG 图形共用） */
export const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function val(id: string): string {
  const node = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  return node?.value.trim() ?? '';
}

export function field(
  id: string,
  label: string,
  value: string,
  opts?: { textarea?: boolean; placeholder?: string; rows?: number },
): HTMLElement {
  const wrap = el('div', 'view-field');
  const lab = el('label', '', label);
  lab.setAttribute('for', id);
  const input = opts?.textarea ? document.createElement('textarea') : document.createElement('input');
  input.id = id;
  input.className = 'input' + (opts?.textarea ? ' view-textarea' : '');
  if (opts?.textarea) {
    (input as HTMLTextAreaElement).rows = opts.rows ?? 3;
  } else if (opts?.placeholder) {
    (input as HTMLInputElement).placeholder = opts.placeholder;
  }
  input.value = value;
  wrap.append(lab, input);
  return wrap;
}

export function actionBtn(label: string, danger: boolean, onClick: () => void): HTMLElement {
  const btn = el('button', 'btn' + (danger ? ' btn-danger' : ''), label);
  btn.addEventListener('click', onClick);
  return btn;
}

export function confirmDelete(label: string): boolean {
  return window.confirm(`确定删除${label}？此操作不可撤销。`);
}

export function focusFirstInput(form: HTMLElement): void {
  const first = form.querySelector('input, textarea');
  if (first) (first as HTMLElement).focus();
}

/** 按钮短暂显示「已保存 ✓」后还原 */
export function flashSaved(btn: HTMLElement, label: string): void {
  btn.textContent = '已保存 ✓';
  setTimeout(() => {
    btn.textContent = label;
  }, 1200);
}
