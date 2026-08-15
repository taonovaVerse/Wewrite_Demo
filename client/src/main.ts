import { createEditor } from './editor';
import { TabManager, type TabData } from './tabs';
import { api } from './api';
import { app, activeChapterId, patchChapter } from './app';
import { apiUrl, initApiBase } from './apiBase';
import { setActiveView, refresh } from './sidebar';
import { graphPanel } from './graphPanel';
import type { ViewId } from './views/types';
import { ask, isQuickInputOpen } from './quickInput';
import { isPickOpen, openPalette, openPick, registerCommand, setupPalette } from './commands';
import { setAiStatus, refreshEl as refreshStatusEl } from './status';
import { triggerDetail } from './detail';
import {
  reloadNovels,
  selectNovel,
  createNovel,
  createChapter,
  openNovelFolder,
  renameNovel,
  deleteNovel,
} from './novels';
import { el, confirmDelete } from './ui';
import './styles.css';

// ---------- 渲染：标签页 ----------

function renderTabs(): void {
  const tabsEl = document.getElementById('tabs')!;
  tabsEl.innerHTML = '';
  const mgr = app.tabs;
  if (mgr) {
    for (const tab of mgr.all()) tabsEl.appendChild(tabNode(tab));
  }
  const add = document.createElement('button');
  add.className = 'tab-add';
  add.textContent = '+';
  add.title = '新建章节';
  add.addEventListener('click', () => void newChapterCmd());
  tabsEl.appendChild(add);
}

function tabNode(tab: TabData): HTMLElement {
  const mgr = app.tabs!;
  const active = mgr.activeKey === tab.key;
  const node = el('div', 'tab' + (active ? ' active' : ''));
  node.title = tab.title || `第 ${tab.orderIdx} 章`;
  if (tab.dirty) node.appendChild(el('span', 'tab-dirty', ''));
  const title = el('span', 'tab-title', tab.kind === 'doc' ? tab.title : tab.title || `§${tab.orderIdx}`);
  const close = document.createElement('button');
  close.className = 'tab-close';
  close.textContent = '×';
  close.title = '关闭';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    void mgr.close(tab.key);
  });
  node.append(title, close);
  node.addEventListener('click', () => mgr.switchTo(tab.key));
  node.addEventListener('auxclick', (e) => {
    if (e.button === 1) void mgr.close(tab.key);
  });
  return node;
}

// ---------- 渲染：状态栏 ----------

function statusItem(text: string): HTMLElement {
  const node = el('span', 'statusbar-item');
  node.textContent = text;
  return node;
}

function renderStatusbar(): void {
  const bar = document.getElementById('statusbar')!;
  bar.innerHTML = '';
  const left = el('div', 'statusbar-left');
  const right = el('div', 'statusbar-right');

  if (app.currentNovel) left.appendChild(statusItem(app.currentNovel.title));
  const active = app.tabs?.active ?? null;
  if (active) {
    // 文档 tab 只显示标题（无章节序号）
    left.appendChild(statusItem(active.kind === 'doc' ? active.title : `§${active.orderIdx} ${active.title}`));
    const save = statusItem(active.dirty ? '未保存' : '已保存');
    save.className = 'statusbar-item statusbar-save' + (active.dirty ? ' dirty' : '');
    left.appendChild(save);
  }

  const view = app.editor?.view;
  right.appendChild(statusItem(`字数 ${view ? view.state.doc.length : 0}`));
  right.appendChild(statusItem('DeepSeek'));
  const ai = el('span', 'statusbar-ai');
  ai.id = 'statusbar-ai';
  right.appendChild(ai);

  bar.append(left, right);
  refreshStatusEl();

  const empty = document.getElementById('editor-empty')!;
  empty.classList.toggle('hidden', active != null);
}

// ---------- Layer 3 续写 ----------

function cancelGeneration(): void {
  app.abortCtrl?.abort();
}

function toggleContinue(): void {
  if (app.generating) {
    cancelGeneration();
    return;
  }
  void continueWriting();
}

async function continueWriting(): Promise<void> {
  const chapterId = activeChapterId();
  const view = app.editor?.view;
  if (chapterId == null || !view) return;
  await app.tabs?.flushActive();
  if (app.generating || activeChapterId() !== chapterId) return;

  app.generating = true;
  const ctrl = new AbortController();
  app.abortCtrl = ctrl;
  setAiStatus('续写中…（Esc 停止）', 'working');

  const startPos = view.state.selection.main.head;
  let pos = startPos;
  let fullText = '';
  let warned = false;

  try {
    const res = await fetch(apiUrl('/api/ai/continue'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.replace(/^data:\s*/, '').trim();
        if (!line) continue;
        let evt: { type: string; text?: string; message?: string };
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === 'token' && evt.text) {
          if (app.tabs?.activeId !== chapterId) {
            ctrl.abort();
            break;
          }
          fullText += evt.text;
          view.dispatch({ changes: { from: pos, insert: evt.text } });
          pos += evt.text.length;
        } else if (evt.type === 'warning' && !warned) {
          warned = true;
          setAiStatus('⚠ AI 提示可能偏离大纲，请审阅', 'warn');
        } else if (evt.type === 'error') {
          setAiStatus('✗ ' + (evt.message ?? '未知错误'), 'error');
        }
      }
    }

    if (app.tabs?.activeId === chapterId) {
      const inserted = view.state.sliceDoc(startPos, pos);
      if (inserted === fullText && fullText.includes('【偏离预警】')) {
        const clean = stripWarning(fullText);
        if (clean !== fullText) {
          view.dispatch({
            changes: { from: startPos, to: pos, insert: clean },
            selection: { anchor: startPos + clean.length },
          });
        }
        setAiStatus('⚠ AI 提示可能偏离大纲，已移除预警段，请审阅续写内容', 'warn');
      } else if (!warned) {
        setAiStatus('', '');
      }
    }
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      setAiStatus('✗ ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  } finally {
    app.generating = false;
    if (app.abortCtrl === ctrl) app.abortCtrl = null;
    if (!warned) setAiStatus('', '');
  }
}

function stripWarning(text: string): string {
  const idx = text.indexOf('【偏离预警】');
  if (idx === -1) return text;
  const rest = text.slice(idx);
  const end = rest.indexOf('\n\n');
  if (end === -1) return text.slice(0, idx);
  return text.slice(0, idx) + rest.slice(end + 2);
}

// ---------- 命令：文件操作 ----------

async function newNovelCmd(): Promise<void> {
  const title = await ask('小说标题', '例如：雨夜便利店');
  if (!title?.trim()) return;
  await createNovel(title.trim());
  await refresh();
}

async function openNovelFolderCmd(): Promise<void> {
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

async function renameNovelCmd(): Promise<void> {
  const current = app.currentNovel;
  if (!current) return;
  const title = await ask('小说标题', '', current.title);
  if (!title || title.trim() === '' || title.trim() === current.title) return;
  await renameNovel(current.id, title.trim());
  await refresh();
}

async function deleteNovelCmd(): Promise<void> {
  const current = app.currentNovel;
  if (!current) return;
  if (!confirmDelete(`小说「${current.title}」及其全部内容`)) return;
  await deleteNovel(current.id);
  await refresh();
}

async function newChapterCmd(): Promise<void> {
  if (!app.currentNovel) {
    await newNovelCmd();
    return;
  }
  const title = await ask('章节标题（可留空）');
  if (title === null) return;
  await createChapter(title);
  await refresh();
}

function closeActiveTab(): void {
  const key = app.tabs?.activeKey;
  if (key != null) void app.tabs?.close(key);
}

function saveActive(): void {
  void app.tabs?.flushActive();
}

function quickOpenChapter(): void {
  const chapters = app.currentNovel?.chapters ?? [];
  const items = chapters.map((ch) => ({
    label: ch.title || `第 ${ch.order_idx} 章`,
    detail: `§${ch.order_idx}`,
    run: () => app.tabs?.openChapter(ch),
  }));
  openPick(
    items.length > 0
      ? items
      : [{ label: '新建章节', detail: '文件', run: () => void newChapterCmd() }],
    '打开章节',
    '章节标题…',
  );
}

// ---------- 命令注册 ----------

function registerCommands(): void {
  registerCommand({ id: 'novel.new', label: '新建小说', category: '文件', run: () => void newNovelCmd() });
  registerCommand({ id: 'novel.openFolder', label: '打开小说文件夹…', category: '文件', run: () => void openNovelFolderCmd() });
  registerCommand({ id: 'novel.rename', label: '重命名小说', category: '文件', run: () => void renameNovelCmd() });
  registerCommand({ id: 'novel.delete', label: '删除小说', category: '文件', run: () => void deleteNovelCmd() });
  registerCommand({ id: 'chapter.new', label: '新建章节', category: '文件', run: () => void newChapterCmd() });
  registerCommand({ id: 'chapter.open', label: '打开章节…', category: '文件', run: quickOpenChapter });
  registerCommand({ id: 'tab.close', label: '关闭当前标签', category: '文件', run: closeActiveTab });
  registerCommand({ id: 'file.save', label: '保存', category: '文件', run: saveActive });
  registerCommand({ id: 'ai.continue', label: '续写一段', category: 'AI', run: () => void toggleContinue() });
  registerCommand({ id: 'ai.detail', label: '生成场景细节', category: 'AI', run: () => void triggerDetail() });

  const viewCmds: [ViewId, string][] = [
    ['explorer', '资源管理器'],
    ['characters', '人物卡'],
    ['world', '世界观'],
    ['foreshadow', '伏笔'],
    ['style', '文风'],
    ['blueprint', '章节细纲'],
    ['history', '历史记录'],
  ];
  for (const [vid, label] of viewCmds) {
    registerCommand({
      id: `view.${vid}`,
      label: `切换到${label}`,
      category: '视图',
      run: () => setActiveView(vid),
    });
  }
}

// ---------- 快捷键 ----------

window.addEventListener('keydown', (e) => {
  if (isPickOpen() || isQuickInputOpen()) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    openPalette();
  } else if (mod && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    quickOpenChapter();
  } else if (mod && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    closeActiveTab();
  } else if (mod && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    saveActive();
  } else if (mod && e.key === '\\') {
    e.preventDefault();
    toggleContinue();
  } else if (mod && e.shiftKey && e.key === '\\') {
    e.preventDefault();
    void triggerDetail();
  } else if (mod && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
    e.preventDefault();
    setActiveView('explorer');
  } else if (mod && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
    e.preventDefault();
    setActiveView('blueprint');
  } else if (e.key === 'Escape') {
    if (app.generating) cancelGeneration();
  }
});

// ---------- 启动 ----------

async function init(): Promise<void> {
  await initApiBase();
  const editorWrapEl = document.getElementById('editor-wrap')!;
  const handle = createEditor(editorWrapEl, '', {
    onChange: () => app.tabs?.onEditorChange(),
    requestSuggestion: (req) =>
      app.tabs ? app.tabs.requestSuggestionForActive(req) : Promise.resolve(''),
    isSwitching: () => app.tabs?.isSwitching ?? false,
  }, true);
  app.editor = handle;
  app.tabs = new TabManager(handle, {
    saveChapter: async (id, content) => {
      const updated = await api.saveChapter(id, { content });
      patchChapter(updated);
    },
    saveDoc: async (kind, docId, content) => {
      const novelId = app.currentNovel?.id;
      if (novelId == null) return;
      await api.saveDoc(kind, docId, { body: content, novelId });
    },
    requestSuggestion: async (req, chapterId) => {
      const res = await fetch(apiUrl('/api/ai/autocomplete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterId,
          textBefore: req.textBefore,
          textAfter: req.textAfter,
        }),
        signal: req.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { text?: string };
      return data.text ?? '';
    },
    onTabsChange: renderTabs,
    onActiveChange: renderStatusbar,
  });

  graphPanel.mount();

  document.querySelectorAll('#activitybar .activity-item').forEach((node) => {
    node.addEventListener('click', () => {
      setActiveView(node.getAttribute('data-view') as ViewId);
    });
  });

  setupPalette();
  registerCommands();
  renderTabs();
  renderStatusbar();

  await reloadNovels();
  if (app.novels.length > 0) {
    const first = app.novels[0];
    if (!app.currentNovel || app.currentNovel.id !== first.id) {
      await selectNovel(first.id);
    }
  }
  await refresh();
}

void init();
