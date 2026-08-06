import { app, activeChapterId } from '../app';
import { api, type Novel, type Chapter, type FileNode, type DocKind, type DocRow } from '../api';
import { el, confirmDelete } from '../ui';
import { ask } from '../quickInput';
import { refresh, setActiveView } from '../sidebar';
import {
  selectNovel,
  createNovel,
  createChapter,
  renameChapter,
  deleteChapter,
  moveChapter,
  createDoc as createNovelDoc,
  deleteDoc as deleteNovelDoc,
  openNovelFolder,
  renameNovel,
  deleteNovel,
} from '../novels';
import type { SidebarView, ViewId } from './types';

/** 「+ 新建章节」的落点文件夹（相对小说根，'' = 根目录）；点文件夹行时更新 */
let currentFolder = '';

/** 「打开文件夹」按钮：把磁盘上任意目录挂载为外部小说 */
function openFolderBtn(): HTMLButtonElement {
  const btn = el('button', 'btn', '打开文件夹') as HTMLButtonElement;
  btn.title = '把磁盘上任意文件夹挂载为小说';
  btn.addEventListener('click', () => void doOpenNovelFolder());
  return btn;
}

async function render(container: HTMLElement): Promise<void> {
  container.innerHTML = '';
  if (app.novels.length === 0) {
    const wrap = el('div', 'view-section');
    wrap.appendChild(el('div', 'view-hint', '还没有小说。新建一部，开始写作。'));
    const btn = el('button', 'btn btn-primary', '新建小说');
    btn.addEventListener('click', () => void newNovel());
    wrap.appendChild(btn);
    wrap.appendChild(openFolderBtn());
    container.appendChild(wrap);
    return;
  }
  const section = el('div', 'view-section');
  section.appendChild(el('div', 'tree-section-title', '小说'));
  section.appendChild(openFolderBtn());
  for (const novel of app.novels) {
    section.appendChild(novelTree(novel));
  }
  section.appendChild(docsGroup());
  container.appendChild(section);
}

function novelTree(novel: Novel): HTMLElement {
  const isActive = app.currentNovel?.id === novel.id;
  const tree = el('div', 'tree-section');
  const row = el('div', 'tree-novel' + (isActive ? ' active' : ''));
  const caret = el('span', 'caret open', '▶');
  row.append(caret, el('span', 'tree-novel-title', novel.title));
  if (novel.external) row.appendChild(el('span', 'tree-novel-badge', '外部'));
  const actions = el('div', 'row-actions');
  actions.append(
    rowBtn('改', '重命名小说', () => void doRenameNovel(novel)),
    rowBtn('删', '删除小说', () => void doDeleteNovel(novel), true),
  );
  row.appendChild(actions);
  row.addEventListener('click', () => {
    if (isActive) return;
    currentFolder = '';
    void selectNovel(novel.id).then(() => refresh());
  });
  tree.appendChild(row);

  const list = el('div', 'chapter-list');
  if (isActive && app.currentNovel) {
    if (app.currentNovel.tree.length === 0) {
      list.appendChild(el('div', 'view-hint', '还没有章节。点右上角 + 新建。'));
    } else {
      for (const node of app.currentNovel.tree) {
        list.appendChild(nodeRow(node));
      }
    }
  }
  tree.appendChild(list);
  return tree;
}

function nodeRow(node: FileNode): HTMLElement {
  return node.type === 'folder' ? folderRow(node) : fileRow(node);
}

/** 树行类型图标（文件夹/文件），颜色随 CSS --muted */
function treeIcon(type: 'folder' | 'file'): HTMLElement {
  const wrap = el('span', 'tree-icon');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  body.setAttribute(
    'd',
    type === 'folder'
      ? 'M2 3.5h4l1.5 2H14v7.5H2z'
      : 'M9.5 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5z',
  );
  svg.appendChild(body);
  if (type === 'file') {
    const fold = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    fold.setAttribute('d', 'M9.5 1.5V5H13');
    svg.appendChild(fold);
  }
  wrap.appendChild(svg);
  return wrap;
}

function folderRow(node: FileNode): HTMLElement {
  const item = el('div', 'tree-folder');
  const head = el('div', 'tree-folder-head');
  const caret = el('span', 'caret open', '▶');
  head.append(caret, treeIcon('folder'), el('span', 'tree-folder-name', node.name));
  const actions = el('div', 'row-actions');
  actions.append(
    rowBtn('章', '在此文件夹新建章节', () => void newChapterIn(node.path)),
    rowBtn('夹', '新建子文件夹', () => void newFolderIn(node.path)),
    rowBtn('改', '重命名文件夹', () => void doRenameFolder(node)),
    rowBtn('删', '删除文件夹（含全部内容）', () => void doDeleteFolder(node), true),
  );
  head.appendChild(actions);
  head.addEventListener('click', () => {
    currentFolder = node.path;
    const children = item.querySelector('.chapter-list');
    if (children) {
      const collapsed = children.classList.toggle('collapsed');
      caret.classList.toggle('open', !collapsed);
    }
  });
  item.appendChild(head);

  const children = el('div', 'chapter-list');
  for (const child of node.children ?? []) {
    children.appendChild(nodeRow(child));
  }
  item.appendChild(children);

  // 拖放目标：把章节拖进文件夹 → 放到末尾
  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    item.classList.add('drop-target');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    item.classList.remove('drop-target');
    const id = Number(e.dataTransfer?.getData('text/plain'));
    if (Number.isInteger(id)) void doMove(id, node.path);
  });
  return item;
}

function fileRow(node: FileNode): HTMLElement {
  const ch = app.currentNovel?.chapters.find((c) => c.id === node.chapterId);
  const isActive = ch != null && activeChapterId() === ch.id;
  const row = el('div', 'tree-chapter' + (isActive ? ' active' : ''));
  const title = el('span', 'tree-chapter-title', ch?.title ?? node.name.replace(/\.md$/, ''));
  row.append(treeIcon('file'), title);
  const actions = el('div', 'row-actions');
  actions.append(
    rowBtn('改', '重命名', () => ch && void doRename(ch)),
    rowBtn('删', '删除章节', () => ch && void doDelete(ch), true),
  );
  row.appendChild(actions);
  row.addEventListener('click', () => {
    if (ch) app.tabs?.openChapter(ch);
  });

  // 可拖拽源：拖章节到文件夹/其他章节前实现移动排序
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', String(ch?.id ?? node.chapterId ?? ''));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drop-target');
    const id = Number(e.dataTransfer?.getData('text/plain'));
    const beforeId = ch?.id ?? node.chapterId;
    if (Number.isInteger(id) && id !== beforeId) void doMove(id, node.folder, beforeId);
  });
  return row;
}

/** 树行内的小按钮（章/夹/改/删） */
function rowBtn(
  label: string,
  title: string,
  onClick: () => void,
  danger = false,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.title = title;
  if (danger) btn.className = 'danger';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** 树顶「文档」组：每类一个可展开文件夹行（表单/新建），子级为记录文件行 */
const DOC_KINDS: Array<{ kind: DocKind; label: string; view: ViewId }> = [
  { kind: 'characters', label: '人物卡', view: 'characters' },
  { kind: 'world', label: '世界观', view: 'world' },
  { kind: 'foreshadow', label: '伏笔', view: 'foreshadow' },
  { kind: 'style', label: '文风', view: 'style' },
  { kind: 'bank', label: '素材库', view: 'bank' },
];

function docsGroup(): HTMLElement {
  const group = el('div', 'tree-section');
  group.appendChild(el('div', 'tree-section-title', '文档'));
  for (const meta of DOC_KINDS) group.appendChild(docFolderRow(meta));
  return group;
}

function docFolderRow(meta: { kind: DocKind; label: string; view: ViewId }): HTMLElement {
  const item = el('div', 'tree-folder');
  const head = el('div', 'tree-folder-head');
  const caret = el('span', 'caret open', '▶');
  head.append(caret, treeIcon('folder'), el('span', 'tree-folder-name', meta.label));
  const actions = el('div', 'row-actions');
  actions.append(
    rowBtn('表', '表单编辑', () => setActiveView(meta.view)),
    rowBtn('＋', '新建记录', () => void newDoc(meta.kind)),
  );
  head.appendChild(actions);
  head.addEventListener('click', () => {
    const children = item.querySelector('.chapter-list');
    if (children) {
      const collapsed = children.classList.toggle('collapsed');
      caret.classList.toggle('open', !collapsed);
    }
  });
  item.appendChild(head);

  const children = el('div', 'chapter-list');
  const docs = (app.currentNovel?.docs ?? []).filter((d) => d.kind === meta.kind);
  if (docs.length === 0) {
    children.appendChild(el('div', 'view-hint', '暂无记录，点 ＋ 新建'));
  } else {
    for (const doc of docs) children.appendChild(docFileRow(doc));
  }
  item.appendChild(children);
  return item;
}

function isActiveDoc(doc: DocRow): boolean {
  const active = app.tabs?.active;
  return active?.kind === 'doc' && active.docKind === doc.kind && active.docId === doc.id;
}

function docFileRow(doc: DocRow): HTMLElement {
  const row = el('div', 'tree-doc' + (isActiveDoc(doc) ? ' active' : ''));
  row.append(treeIcon('file'), el('span', 'tree-doc-title', doc.title));
  const actions = el('div', 'row-actions');
  if (doc.kind === 'characters' || doc.kind === 'world') {
    actions.append(rowBtn('改', '重命名', () => void doRenameDoc(doc)));
  }
  actions.append(rowBtn('删', '删除文档', () => void doDeleteDoc(doc), true));
  row.appendChild(actions);
  row.addEventListener('click', () => app.tabs?.openDoc(doc));
  return row;
}

async function newDoc(kind: DocKind): Promise<void> {
  let title: string | undefined;
  if (kind === 'characters' || kind === 'world') {
    const label = kind === 'characters' ? '人物名' : '设定 key';
    const name = await ask(`新建${DOC_KINDS.find((m) => m.kind === kind)?.label ?? ''}`, label);
    if (name === null) return;
    if (!name?.trim()) return;
    title = name.trim();
  }
  await createNovelDoc(kind, title);
  await refresh();
}

async function doRenameDoc(doc: DocRow): Promise<void> {
  const current = String(
    doc.kind === 'characters' ? (doc.fields.name ?? '') : (doc.fields.key ?? ''),
  );
  const name = await ask(doc.kind === 'characters' ? '人物名' : '设定 key', '', current);
  if (!name || name.trim() === '' || name.trim() === current) return;
  const novelId = app.currentNovel?.id;
  if (novelId == null) return;
  const fieldKey = doc.kind === 'characters' ? 'name' : 'key';
  await api.saveDoc(doc.kind, doc.id, {
    novelId,
    fields: { [fieldKey]: name.trim() },
    title: name.trim(),
  });
  await refresh();
}

async function doDeleteDoc(doc: DocRow): Promise<void> {
  if (!confirmDelete(`文档「${doc.title}」`)) return;
  await deleteNovelDoc(doc.kind, doc.id);
  await refresh();
}

async function newNovel(): Promise<void> {
  const title = await ask('小说标题', '例如：雨夜便利店');
  if (!title?.trim()) return;
  await createNovel(title.trim());
  await refresh();
}

async function doOpenNovelFolder(): Promise<void> {
  const path = await ask('打开小说文件夹', '例如：D:\\我的小说');
  if (!path?.trim()) return;
  try {
    await openNovelFolder(path.trim());
  } catch (e) {
    alert(e instanceof Error ? e.message : '打开文件夹失败');
    return;
  }
  await refresh();
}

async function doRenameNovel(novel: Novel): Promise<void> {
  const title = await ask('小说标题', '', novel.title);
  if (!title || title.trim() === '' || title.trim() === novel.title) return;
  await renameNovel(novel.id, title);
  await refresh();
}

async function doDeleteNovel(novel: Novel): Promise<void> {
  if (!confirmDelete(`小说「${novel.title}」及其全部内容`)) return;
  await deleteNovel(novel.id);
  await refresh();
}

async function newChapter(): Promise<void> {
  if (!app.currentNovel) {
    await newNovel();
    return;
  }
  const title = await ask('章节标题（可留空）', `文件夹：${currentFolder || '根目录'}`);
  if (title === null) return;
  await createChapter(title, currentFolder);
  await refresh();
}

async function newChapterIn(folder: string): Promise<void> {
  const title = await ask('章节标题（可留空）', `文件夹：${folder || '根目录'}`);
  if (title === null) return;
  await createChapter(title, folder);
  await refresh();
}

async function newFolderIn(parent: string): Promise<void> {
  const name = await ask('文件夹名称');
  if (!name?.trim()) return;
  if (!app.currentNovel) return;
  await api.createFolder(app.currentNovel.id, name.trim(), parent);
  await refresh();
}

async function doRename(ch: Chapter): Promise<void> {
  const title = await ask('章节标题', '', ch.title);
  if (title === null || title.trim() === '' || title.trim() === ch.title) return;
  await renameChapter(ch, title);
  await refresh();
}

async function doDelete(ch: Chapter): Promise<void> {
  if (!confirmDelete(`章节「${ch.title || `第 ${ch.order_idx} 章`}」`)) return;
  await deleteChapter(ch.id);
  await refresh();
}

async function doRenameFolder(node: FileNode): Promise<void> {
  const name = await ask('文件夹名称', '', node.name);
  if (!name || name.trim() === '' || name.trim() === node.name) return;
  if (!app.currentNovel) return;
  await api.renameFolder(app.currentNovel.id, node.path, name.trim());
  await refresh();
}

async function doDeleteFolder(node: FileNode): Promise<void> {
  if (!confirmDelete(`文件夹「${node.name}」及其全部内容`)) return;
  if (!app.currentNovel) return;
  await api.deleteFolder(app.currentNovel.id, node.path);
  await refresh();
}

async function doMove(chapterId: number, folder: string, beforeId?: number): Promise<void> {
  const src = app.currentNovel?.chapters.find((c) => c.id === chapterId);
  // 同夹、且非真正插入位：视为无操作
  if (src && src.folder === folder && (beforeId === undefined || beforeId === chapterId)) return;
  await moveChapter(chapterId, folder, beforeId);
  await refresh();
}

export const explorerView: SidebarView = {
  id: 'explorer',
  label: '资源管理器',
  headerTitle: '新建章节',
  render,
  headerButton: () => void newChapter(),
};
