import { app, activeChapterId } from '../app';
import type { Novel, Chapter } from '../api';
import { el, confirmDelete } from '../ui';
import { ask } from '../quickInput';
import { refresh } from '../sidebar';
import {
  selectNovel,
  createNovel,
  createChapter,
  renameChapter,
  deleteChapter,
} from '../novels';
import type { SidebarView } from './types';

async function render(container: HTMLElement): Promise<void> {
  container.innerHTML = '';
  if (app.novels.length === 0) {
    const wrap = el('div', 'view-section');
    wrap.appendChild(el('div', 'view-hint', '还没有小说。新建一部，开始写作。'));
    const btn = el('button', 'btn btn-primary', '新建小说');
    btn.addEventListener('click', () => void newNovel());
    wrap.appendChild(btn);
    container.appendChild(wrap);
    return;
  }
  const section = el('div', 'view-section');
  section.appendChild(el('div', 'tree-section-title', '小说'));
  for (const novel of app.novels) {
    section.appendChild(novelTree(novel));
  }
  container.appendChild(section);
}

function novelTree(novel: Novel): HTMLElement {
  const isActive = app.currentNovel?.id === novel.id;
  const tree = el('div', 'tree-section');
  const row = el('div', 'tree-novel' + (isActive ? ' active' : ''));
  const caret = el('span', 'caret open', '▶');
  row.append(caret, el('span', 'tree-novel-title', novel.title));
  row.addEventListener('click', () => {
    if (isActive) return;
    void selectNovel(novel.id).then(() => refresh());
  });
  tree.appendChild(row);

  const list = el('div', 'chapter-list');
  if (isActive && app.currentNovel) {
    if (app.currentNovel.chapters.length === 0) {
      list.appendChild(el('div', 'view-hint', '还没有章节。点右上角 + 新建。'));
    }
    for (const ch of app.currentNovel.chapters) {
      list.appendChild(chapterRow(ch));
    }
  }
  tree.appendChild(list);
  return tree;
}

function chapterRow(ch: Chapter): HTMLElement {
  const isActive = activeChapterId() === ch.id;
  const row = el('div', 'tree-chapter' + (isActive ? ' active' : ''));
  const title = el('span', 'tree-chapter-title', ch.title || `§${ch.order_idx}`);
  row.appendChild(title);
  const actions = el('div', 'row-actions');
  const ren = document.createElement('button');
  ren.textContent = '改';
  ren.title = '重命名';
  ren.addEventListener('click', (e) => {
    e.stopPropagation();
    void doRename(ch);
  });
  const del = document.createElement('button');
  del.textContent = '删';
  del.title = '删除章节';
  del.className = 'danger';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    void doDelete(ch);
  });
  actions.append(ren, del);
  row.appendChild(actions);
  row.addEventListener('click', () => app.tabs?.openChapter(ch));
  return row;
}

async function newNovel(): Promise<void> {
  const title = await ask('小说标题', '例如：雨夜便利店');
  if (!title?.trim()) return;
  await createNovel(title.trim());
  await refresh();
}

async function newChapter(): Promise<void> {
  if (!app.currentNovel) {
    await newNovel();
    return;
  }
  const title = await ask('章节标题（可留空）');
  if (title === null) return;
  await createChapter(title);
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

export const explorerView: SidebarView = {
  id: 'explorer',
  label: '资源管理器',
  headerTitle: '新建章节',
  render,
  headerButton: () => void newChapter(),
};
