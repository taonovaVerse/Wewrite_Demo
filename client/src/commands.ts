export interface Command {
  id: string;
  label: string;
  category: string;
  run: () => void;
}

export interface PickItem {
  label: string;
  detail?: string;
  run: () => void;
}

const commands: Command[] = [];

export function registerCommand(cmd: Command): void {
  commands.push(cmd);
}

function commandItems(): PickItem[] {
  return commands.map((c) => ({ label: c.label, detail: c.category, run: c.run }));
}

// ---------- 通用快速选择（命令面板 / 章节快速打开共用） ----------

const paletteEl = (): HTMLElement => document.getElementById('palette-overlay')!;
const inputEl = (): HTMLInputElement => document.getElementById('palette-input') as HTMLInputElement;
const listEl = (): HTMLElement => document.getElementById('palette-list')!;
const labelEl = (): HTMLElement => document.getElementById('palette-label')!;

let items: PickItem[] = [];
let selected = 0;

export function openPick(items_: PickItem[], labelText: string, placeholder = ''): void {
  items = items_;
  selected = 0;
  labelEl().textContent = labelText;
  const input = inputEl();
  input.placeholder = placeholder;
  input.value = '';
  paletteEl().classList.remove('hidden');
  renderList('');
  input.focus();
}

function closePick(): void {
  paletteEl().classList.add('hidden');
}

export function isPickOpen(): boolean {
  return !paletteEl().classList.contains('hidden');
}

export function openPalette(): void {
  openPick(commandItems(), '命令面板', '输入命令…');
}

function filtered(q: string): PickItem[] {
  const needle = q.toLowerCase();
  return items.filter((it) => (it.label + ' ' + (it.detail ?? '')).toLowerCase().includes(needle));
}

function renderList(q: string): void {
  const list = filtered(q);
  const el = listEl();
  el.innerHTML = '';
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'overlay-empty';
    empty.textContent = '没有匹配项';
    el.appendChild(empty);
    return;
  }
  if (selected >= list.length) selected = 0;
  list.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'overlay-item' + (i === selected ? ' selected' : '');
    row.appendChild(document.createTextNode(item.label));
    if (item.detail) {
      const cat = document.createElement('span');
      cat.className = 'ov-cat';
      cat.textContent = item.detail;
      row.appendChild(cat);
    }
    row.addEventListener('click', () => runItem(item));
    row.addEventListener('mousemove', () => {
      selected = i;
      updateSelection();
    });
    el.appendChild(row);
  });
}

function updateSelection(): void {
  const rows = listEl().querySelectorAll('.overlay-item');
  rows.forEach((r, i) => r.classList.toggle('selected', i === selected));
}

function runItem(item: PickItem): void {
  closePick();
  item.run();
}

export function setupPalette(): void {
  const input = inputEl();
  input.addEventListener('input', () => {
    selected = 0;
    renderList(input.value);
  });
  input.addEventListener('keydown', (e) => {
    const list = filtered(input.value);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selected = Math.min(selected + 1, Math.max(0, list.length - 1));
      updateSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      updateSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = list[selected];
      if (item) runItem(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePick();
    }
  });
  paletteEl().addEventListener('click', (e) => {
    if (e.target === paletteEl()) closePick();
  });
}
