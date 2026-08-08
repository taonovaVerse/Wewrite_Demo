// 人物卡视图（id 仍为 'characters'）：主编辑区是关系图（graphPanel），侧边栏负责
// 人物/关系的增删改。数据源不变——人物仍是 .docs/人物卡/*.md，关系存 .docs/人物关系/人物关系.md。
import { app } from '../app';
import { api, type Character, type CharacterInput, type DocRow } from '../api';
import { el, field, actionBtn, val, confirmDelete } from '../ui';
import { graphPanel, type GraphEdge } from '../graphPanel';
import type { SidebarView } from './types';

// 侧边栏当前编辑面板
type Panel =
  | { kind: 'none' }
  | { kind: 'charNew' }
  | { kind: 'char'; id: number }
  | { kind: 'relNew'; a?: number; b?: number }
  | { kind: 'relEdit'; idx: number };

let currentContainer: HTMLElement | null = null;
let characters: Character[] = [];
let edges: GraphEdge[] = [];
let relationsDoc: DocRow | null = null;
let onlyMain = false;
let panelState: Panel = { kind: 'none' };

// ---- 数据 ----

async function ensureRelations(novelId: number): Promise<DocRow> {
  const docs = await api.listDocs(novelId, 'relations');
  if (docs.length > 0) return docs[0];
  return api.createDoc({ novelId, kind: 'relations' });
}

function parseEdges(doc: DocRow): GraphEdge[] {
  try {
    const v = JSON.parse(String(doc.fields.edges ?? '[]'));
    if (Array.isArray(v)) return v as GraphEdge[];
  } catch {
    /* 坏 JSON 忽略 */
  }
  return [];
}

async function saveEdges(): Promise<void> {
  const novelId = app.currentNovel?.id;
  if (!novelId || !relationsDoc) return;
  relationsDoc = await api.saveDoc('relations', relationsDoc.id, {
    novelId,
    fields: { edges: JSON.stringify(edges) },
  });
}

/** 拉取数据 → 喂图板 → 重绘侧边栏。container 仅在视图首次渲染时传入，内部重载复用已有容器 */
async function load(container?: HTMLElement): Promise<void> {
  if (container) currentContainer = container;
  const novelId = app.currentNovel?.id;
  if (!novelId) {
    characters = [];
    edges = [];
    graphPanel.setData([], []);
    draw();
    return;
  }
  const [chars, relDoc] = await Promise.all([api.characters(novelId), ensureRelations(novelId)]);
  characters = chars;
  relationsDoc = relDoc;
  const ids = new Set(chars.map((c) => c.id));
  edges = parseEdges(relDoc).filter((e) => ids.has(e.a) && ids.has(e.b));
  pushData();
  draw();
}

/** 把「只看主要」过滤后的人物+边推给图板，并同步选中态 */
function pushData(): void {
  const visible = onlyMain ? characters.filter((c) => c.main) : characters;
  graphPanel.setData(visible, edges);
  syncSelection();
}

function syncSelection(): void {
  if (panelState.kind === 'char') graphPanel.selectNode(panelState.id);
  else if (panelState.kind === 'relEdit') graphPanel.selectEdge(panelState.idx);
  else graphPanel.selectNode(null);
}

function draw(): void {
  const c = currentContainer;
  if (!c) return;
  c.innerHTML = '';
  if (!app.currentNovel?.id) {
    c.appendChild(el('div', 'view-hint', '先在资源管理器中选择一部小说。'));
    return;
  }
  renderToolbar(c);
  renderList(c);
  renderPanel(c);
}

// ---- 工具栏 ----

function renderToolbar(c: HTMLElement): void {
  const bar = el('div', 'graph-toolbar');
  bar.appendChild(actionBtn('＋人物', false, () => void startNewChar()));
  bar.appendChild(actionBtn('＋关系', false, () => void startNewRel()));
  const link = actionBtn('连线', false, () => {
    if (graphPanel.isLinkMode) graphPanel.setLinkMode(false);
    else {
      graphPanel.setLinkMode(true);
      panelState = { kind: 'none' };
    }
    draw();
  });
  link.classList.toggle('btn-primary', graphPanel.isLinkMode);
  bar.appendChild(link);
  const lab = el('label', 'graph-toggle');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = onlyMain;
  cb.addEventListener('change', () => {
    onlyMain = cb.checked;
    pushData();
    draw();
  });
  lab.append(cb, el('span', '', '只看主要'));
  bar.appendChild(lab);
  c.appendChild(bar);
}

// ---- 人物列表 ----

function renderList(c: HTMLElement): void {
  const visible = onlyMain ? characters.filter((x) => x.main) : characters;
  const list = el('div', 'view-list');
  if (visible.length === 0) {
    list.appendChild(
      el('div', 'view-hint', onlyMain ? '还没有标为「主要」的人物。' : '还没有人物，点 ＋人物 创建。'),
    );
    c.appendChild(list);
    return;
  }
  for (const ch of visible) {
    const row = el(
      'div',
      'view-item' + (graphPanel.selectedNodeId === ch.id ? ' graph-selected' : ''),
    );
    const info = el('div', 'view-item-info');
    info.appendChild(
      el(
        'div',
        'view-item-title',
        ch.name + (ch.main ? ' ★' : '') + (ch.status ? `（${ch.status}）` : ''),
      ),
    );
    const details = [ch.profile, ch.speaking_style ? `口癖：${ch.speaking_style}` : '']
      .filter(Boolean)
      .join(' / ');
    info.appendChild(el('div', 'view-item-body', details || '—'));
    row.appendChild(info);
    const actions = el('div', 'view-item-actions');
    actions.appendChild(actionBtn('删除', true, () => void deleteChar(ch.id)));
    row.appendChild(actions);
    row.addEventListener('click', () => selectChar(ch.id));
    list.appendChild(row);
  }
  c.appendChild(list);
}

// ---- 编辑面板 ----

function renderPanel(c: HTMLElement): void {
  const p = panelState;
  if (p.kind === 'none') {
    if (graphPanel.isLinkMode) {
      c.appendChild(el('div', 'view-hint', '连线模式：在图上依次点两个人物建立关系（Esc 或再点「连线」退出）。'));
    }
    return;
  }
  if (p.kind === 'charNew') {
    c.appendChild(charForm(null));
    return;
  }
  if (p.kind === 'char') {
    const edit = characters.find((x) => x.id === p.id) ?? null;
    c.appendChild(charForm(edit));
    return;
  }
  if (p.kind === 'relNew') {
    c.appendChild(relForm(undefined, p.a, p.b));
    return;
  }
  const e = edges[p.idx];
  if (e) c.appendChild(relForm(e, e.a, e.b));
}

function charForm(edit: Character | null): HTMLElement {
  const form = el('div', 'view-form');
  form.append(
    field('rel-char-name', '姓名 *', edit?.name ?? '', { placeholder: '林晚' }),
    field('rel-char-profile', '身份/背景', edit?.profile ?? '', { textarea: true, rows: 2 }),
    field('rel-char-speak', '口癖/说话习惯', edit?.speaking_style ?? '', { placeholder: '话少，短句' }),
    field('rel-char-status', '当前状态', edit?.status ?? '', { placeholder: '深夜值班' }),
  );
  const mainLab = el('label', 'view-field graph-char-main');
  const mainCb = document.createElement('input');
  mainCb.type = 'checkbox';
  mainCb.id = 'rel-char-main';
  mainCb.checked = edit?.main ?? false;
  mainLab.append(mainCb, el('span', '', '主要人物（图上强调）'));
  form.appendChild(mainLab);
  const row = el('div', 'view-form-row');
  row.appendChild(actionBtn(edit ? '保存修改' : '添加人物', false, () => void saveChar(edit)));
  if (edit) row.appendChild(actionBtn('删除', true, () => void deleteChar(edit.id)));
  row.appendChild(actionBtn('取消', false, () => void cancel()));
  form.appendChild(row);
  return form;
}

function charSelect(
  id: string,
  label: string,
  value: number | undefined,
  exclude: number | undefined,
): HTMLElement {
  const wrap = el('div', 'view-field');
  const lab = el('label', '', label);
  lab.setAttribute('for', id);
  const sel = document.createElement('select');
  sel.id = id;
  sel.className = 'input';
  if (value == null) {
    const ph = document.createElement('option');
    ph.value = '-1';
    ph.textContent = '（选择人物）';
    ph.selected = true;
    sel.appendChild(ph);
  }
  for (const ch of characters) {
    if (ch.id === exclude) continue;
    const opt = document.createElement('option');
    opt.value = String(ch.id);
    opt.textContent = ch.name;
    if (ch.id === value) opt.selected = true;
    sel.appendChild(opt);
  }
  wrap.append(lab, sel);
  return wrap;
}

function relForm(edit: GraphEdge | undefined, a?: number, b?: number): HTMLElement {
  const form = el('div', 'view-form');
  form.append(
    charSelect('rel-rel-a', '人物 A', a, b),
    charSelect('rel-rel-b', '人物 B', b, a),
    field('rel-rel-label', '关系', edit?.label ?? '', { placeholder: '夫妻 / 师徒 / 仇敌…' }),
    field('rel-rel-note', '备注', edit?.note ?? '', { textarea: true, rows: 2 }),
  );
  const row = el('div', 'view-form-row');
  row.appendChild(actionBtn(edit ? '保存关系' : '添加关系', false, () => void saveRel(edit)));
  if (edit) row.appendChild(actionBtn('删除', true, () => void deleteRel(edit)));
  row.appendChild(actionBtn('取消', false, () => void cancel()));
  form.appendChild(row);
  return form;
}

// ---- 操作 ----

function cancel(): void {
  panelState = { kind: 'none' };
  syncSelection();
  draw();
}

function selectChar(id: number): void {
  panelState = { kind: 'char', id };
  graphPanel.selectNode(id);
  draw();
}

function startNewChar(): void {
  panelState = { kind: 'charNew' };
  draw();
}

function startNewRel(): void {
  panelState = { kind: 'relNew', a: graphPanel.selectedNodeId ?? undefined };
  draw();
}

async function saveChar(edit: Character | null): Promise<void> {
  const novelId = app.currentNovel?.id;
  if (!novelId) return;
  const name = val('rel-char-name');
  if (!name) return;
  const data: CharacterInput = {
    novelId,
    name,
    profile: val('rel-char-profile'),
    speakingStyle: val('rel-char-speak'),
    status: val('rel-char-status'),
    main: (document.getElementById('rel-char-main') as HTMLInputElement)?.checked ?? false,
  };
  if (edit) await api.updateCharacter(edit.id, data);
  else await api.createCharacter(data);
  panelState = { kind: 'none' };
  await load();
}

async function deleteChar(id: number): Promise<void> {
  const ch = characters.find((x) => x.id === id);
  if (!confirmDelete(`人物「${ch?.name ?? id}」`)) return;
  await api.deleteCharacter(id);
  const before = edges.length;
  edges = edges.filter((e) => e.a !== id && e.b !== id);
  if (edges.length !== before) await saveEdges();
  panelState = { kind: 'none' };
  await load();
}

async function saveRel(edit: GraphEdge | undefined): Promise<void> {
  const a = Number((document.getElementById('rel-rel-a') as HTMLSelectElement)?.value ?? -1);
  const b = Number((document.getElementById('rel-rel-b') as HTMLSelectElement)?.value ?? -1);
  if (a <= 0 || b <= 0 || a === b) return;
  const edge: GraphEdge = { a, b, label: val('rel-rel-label'), note: val('rel-rel-note') };
  if (edit) {
    const idx = edges.indexOf(edit);
    if (idx >= 0) edges[idx] = edge;
  } else {
    edges.push(edge);
  }
  await saveEdges();
  panelState = { kind: 'none' };
  await load();
}

async function deleteRel(edit: GraphEdge): Promise<void> {
  edges = edges.filter((e) => e !== edit);
  await saveEdges();
  panelState = { kind: 'none' };
  await load();
}

// ---- 图板回调（图上点击 → 侧边栏联动） ----

graphPanel.onNodeSelect((id) => {
  panelState = { kind: 'char', id };
  draw();
});
graphPanel.onEdgeSelect((idx) => {
  panelState = { kind: 'relEdit', idx };
  draw();
});
graphPanel.onLink((a, b) => {
  panelState = { kind: 'relNew', a, b };
  draw();
});

// Esc 退出连线模式（工具栏提示文案承诺 Esc 可退出）
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !graphPanel.isLinkMode) return;
  const panel = document.getElementById('graph-panel');
  if (!panel || panel.classList.contains('hidden')) return;
  graphPanel.setLinkMode(false);
  draw();
});

export const relationsView: SidebarView = {
  id: 'characters',
  label: '人物卡',
  headerTitle: '新建人物',
  render: load,
  headerButton: () => {
    panelState = { kind: 'charNew' };
    void draw();
  },
};
