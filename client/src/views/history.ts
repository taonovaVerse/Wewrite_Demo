import { app } from '../app';
import { api, type VersionInfo, type DiffFile, type DiffLine } from '../api';
import { el, actionBtn } from '../ui';
import { reloadNovel } from '../novels';
import type { SidebarView } from './types';

let container: HTMLElement | null = null;
let selectedHash: string | null = null;

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (diff < m) return '刚刚';
  if (diff < h) return `${Math.floor(diff / m)} 分钟前`;
  if (diff < d) return `${Math.floor(diff / h)} 小时前`;
  if (diff < 30 * d) return `${Math.floor(diff / d)} 天前`;
  return new Date(iso).toLocaleDateString();
}

async function render(c: HTMLElement): Promise<void> {
  container = c;
  c.innerHTML = '';
  const novelId = app.currentNovel?.id;
  if (!novelId) {
    c.appendChild(el('div', 'view-hint', '先在资源管理器中选择一部小说。'));
    return;
  }
  const wrap = el('div', 'view-section');
  const row = el('div', 'view-form-row');
  row.appendChild(actionBtn('立即保存快照', false, () => void doSnapshot(novelId)));
  wrap.appendChild(row);
  c.appendChild(wrap);
  await renderList(novelId);
}

async function renderList(novelId: number): Promise<void> {
  const c = container!;
  c.querySelector('#history-list')?.remove();
  c.querySelector('#history-diff')?.remove();

  const listEl = el('div', 'view-list');
  listEl.id = 'history-list';
  c.appendChild(listEl);

  let versions: VersionInfo[];
  let enabled = true;
  try {
    const data = await api.versions(novelId);
    enabled = data.enabled;
    versions = data.versions;
  } catch {
    listEl.appendChild(el('div', 'view-hint', '读取历史失败。'));
    return;
  }
  if (!enabled) {
    listEl.appendChild(el('div', 'view-hint', '该文件夹已有自己的 Git 仓库，未启用版本管理。'));
    return;
  }
  if (versions.length === 0) {
    listEl.appendChild(
      el('div', 'view-hint', '还没有快照。编辑并保存章节后，会自动记录历史版本。'),
    );
    return;
  }
  if (selectedHash !== null && !versions.some((v) => v.hash === selectedHash)) {
    selectedHash = null;
  }
  for (const v of versions) listEl.appendChild(versionItem(v, novelId));
  if (selectedHash !== null) await renderDiff(novelId, selectedHash);
}

function versionItem(v: VersionInfo, novelId: number): HTMLElement {
  const item = el('div', 'view-item');
  item.classList.toggle('history-selected', v.hash === selectedHash);
  const info = el('div', 'view-item-info');
  info.appendChild(el('div', 'view-item-title', v.message || '(无说明)'));
  info.appendChild(el('div', 'view-item-body', `${relativeTime(v.date)} · ${v.hash.slice(0, 7)}`));
  item.appendChild(info);
  item.addEventListener('click', () => {
    selectedHash = selectedHash === v.hash ? null : v.hash;
    void renderList(novelId);
  });
  return item;
}

async function renderDiff(novelId: number, hash: string): Promise<void> {
  const c = container!;
  c.querySelector('#history-diff')?.remove();
  let files: DiffFile[];
  try {
    files = await api.versionDiff(novelId, hash);
  } catch {
    return;
  }
  const panel = el('div', 'view-section');
  panel.id = 'history-diff';
  const bar = el('div', 'view-form-row');
  const title = el(
    'span',
    'view-item-title',
    files.length === 0 ? '该版本无文件变化' : `与上一版相比，变更 ${files.length} 个文件`,
  );
  const restore = actionBtn('恢复此版本', true, () => void doRestore(novelId, hash));
  bar.append(title, restore);
  panel.appendChild(bar);
  for (const f of files) panel.appendChild(diffFile(f));
  c.appendChild(panel);
}

function diffFile(f: DiffFile): HTMLElement {
  const sec = el('div', 'view-item');
  const head = el('div', 'view-item-title');
  head.textContent = `${f.path}   +${f.added} −${f.removed}`;
  const body = el('div', 'view-item-body diff-body');
  for (const line of f.lines) body.appendChild(diffLine(line));
  sec.append(head, body);
  return sec;
}

function diffLine(line: DiffLine): HTMLElement {
  const row = el('div', `diff-line diff-${line.type}`);
  row.textContent = prefixOf(line) + line.text;
  return row;
}

function prefixOf(line: DiffLine): string {
  if (line.type === 'hunk' || line.type === 'meta') return '';
  return line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
}

async function doSnapshot(novelId: number): Promise<void> {
  try {
    await api.snapshot(novelId);
  } catch {
    /* 静默失败（未启用等） */
  }
  await renderList(novelId);
}

async function doRestore(novelId: number, hash: string): Promise<void> {
  if (
    !window.confirm(
      '确定恢复到该版本？当前未保存的改动会先被记录，随后工作区将重置到该版本。',
    )
  ) {
    return;
  }
  try {
    await app.tabs?.flushActive(); // 先把编辑器里未保存的内容写盘，恢复前一起落库
    await api.restoreVersion(novelId, hash);
  } catch (e) {
    window.alert(e instanceof Error ? e.message : '恢复失败');
    return;
  }
  const active = app.tabs?.active;
  selectedHash = null;
  await reloadNovel(); // 服务端已回滚磁盘，重新拉取章节/文档
  await app.tabs?.closeAll();
  if (app.currentNovel && active) {
    if (active.kind === 'chapter') {
      const ch = app.currentNovel.chapters.find((x) => x.id === active.chapterId);
      if (ch) app.tabs?.openChapter(ch);
    } else if (active.kind === 'doc' && active.docKind !== undefined && active.docId !== undefined) {
      const doc = app.currentNovel.docs.find((d) => d.kind === active.docKind && d.id === active.docId);
      if (doc) app.tabs?.openDoc(doc);
    }
  }
  void render(container!);
}

export const historyView: SidebarView = {
  id: 'history',
  label: '历史',
  headerTitle: '立即保存快照',
  render,
  headerButton: () => {
    const novelId = app.currentNovel?.id;
    if (novelId) void doSnapshot(novelId);
  },
};
