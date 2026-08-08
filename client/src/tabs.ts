import { EditorState } from '@codemirror/state';
import type { EditorHandle } from './editor';
import type { Chapter, DocKind, DocRow } from './api';

export interface TabData {
  /** 全局唯一键：章节 `c:<id>`、文档 `d:<kind>:<id>` */
  key: string;
  kind: 'chapter' | 'doc';
  title: string;
  orderIdx: number;
  dirty: boolean;
  savedState: EditorState;
  /** kind==='chapter' 时的章节 id */
  chapterId?: number;
  /** kind==='doc' 时的文档 kind / id */
  docKind?: DocKind;
  docId?: number;
}

export interface TabManagerOptions {
  saveChapter: (chapterId: number, content: string) => Promise<void>;
  saveDoc: (kind: DocKind, docId: number, content: string) => Promise<void>;
  requestSuggestion: (
    req: { textBefore: string; textAfter: string; signal: AbortSignal },
    chapterId: number,
  ) => Promise<string>;
  onTabsChange: () => void;
  onActiveChange: () => void;
}

function chapterKey(id: number): string {
  return `c:${id}`;
}

function docKey(kind: DocKind, id: number): string {
  return `d:${kind}:${id}`;
}

export class TabManager {
  /** 当前活跃 tab 的 key；无 tab 时为 null */
  activeKey: string | null = null;
  isSwitching = false;

  private tabs = new Map<string, TabData>();
  private saveTimer: number | undefined;

  constructor(
    private handle: EditorHandle,
    private opts: TabManagerOptions,
  ) {}

  get count(): number {
    return this.tabs.size;
  }

  /** 当前活跃章节 id（活跃 tab 是文档时返回 null） */
  get activeId(): number | null {
    return this.active?.kind === 'chapter' ? (this.active.chapterId ?? null) : null;
  }

  get activeChapterId(): number | null {
    return this.activeId;
  }

  hasChapter(id: number): boolean {
    return this.tabs.has(chapterKey(id));
  }

  get active(): TabData | null {
    return this.activeKey == null ? null : (this.tabs.get(this.activeKey) ?? null);
  }

  all(): TabData[] {
    return [...this.tabs.values()];
  }

  openChapter(chapter: Chapter): void {
    const key = chapterKey(chapter.id);
    if (this.tabs.has(key)) {
      this.switchTo(key);
      return;
    }
    const state = this.handle.createState(chapter.content, false, 'chapter');
    this.tabs.set(key, {
      key,
      kind: 'chapter',
      title: chapter.title,
      orderIdx: chapter.order_idx,
      dirty: false,
      savedState: state,
      chapterId: chapter.id,
    });
    this.switchTo(key);
  }

  openDoc(doc: DocRow): void {
    const key = docKey(doc.kind, doc.id);
    if (this.tabs.has(key)) {
      this.switchTo(key);
      return;
    }
    const state = this.handle.createState(doc.body, false, 'doc');
    this.tabs.set(key, {
      key,
      kind: 'doc',
      title: doc.title,
      orderIdx: 0,
      dirty: false,
      savedState: state,
      docKind: doc.kind,
      docId: doc.id,
    });
    this.switchTo(key);
  }

  switchTo(key: string): void {
    const next = this.tabs.get(key);
    if (!next) return;
    if (key === this.activeKey) {
      // 已激活 tab 再被点击：不做重复切换
      return;
    }
    this.handle.cancelSuggestion();
    void this.flushActive();
    this.applyState(next.savedState);
    this.activeKey = key;
    this.opts.onActiveChange();
    this.opts.onTabsChange();
  }

  /** 关闭 tab；关闭的是活跃 tab 时切到剩余第一个 */
  async close(key: string): Promise<void> {
    const tab = this.tabs.get(key);
    if (!tab) return;
    if (key === this.activeKey) {
      this.handle.cancelSuggestion();
      await this.flushActive();
      if (!this.tabs.has(key)) return;
      this.tabs.delete(key);
      this.activeKey = null;
      const remaining = [...this.tabs.values()];
      if (remaining.length > 0) {
        const next = remaining[0];
        this.applyState(next.savedState);
        this.activeKey = next.key;
      } else {
        this.applyState(this.handle.createState('', true, 'doc'));
      }
      this.opts.onActiveChange();
      this.opts.onTabsChange();
    } else {
      this.tabs.delete(key);
      this.opts.onTabsChange();
    }
  }

  closeChapter(id: number): Promise<void> {
    return this.close(chapterKey(id));
  }

  closeDoc(kind: DocKind, id: number): Promise<void> {
    return this.close(docKey(kind, id));
  }

  async closeAll(): Promise<void> {
    if (this.activeKey != null) {
      this.handle.cancelSuggestion();
      await this.flushActive();
    }
    this.tabs.clear();
    this.activeKey = null;
    this.applyState(this.handle.createState('', true, 'doc'));
    this.opts.onActiveChange();
    this.opts.onTabsChange();
  }

  rename(id: number, title: string): void {
    const tab = this.tabs.get(chapterKey(id));
    if (!tab) return;
    tab.title = title;
    this.opts.onTabsChange();
  }

  updateFromChapter(ch: Chapter): void {
    const tab = this.tabs.get(chapterKey(ch.id));
    if (!tab) return;
    tab.title = ch.title;
    tab.orderIdx = ch.order_idx;
    this.opts.onTabsChange();
  }

  onEditorChange(): void {
    const tab = this.active;
    if (!tab) return;
    if (!tab.dirty) {
      tab.dirty = true;
      this.opts.onTabsChange();
    }
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flushActive(), 800);
  }

  /** 持久化当前活跃 tab 的正文（若 dirty）。快照在同步段捕获，避免 await 期间切页污染 */
  async flushActive(): Promise<void> {
    const tab = this.active;
    if (!tab || !tab.dirty) return;
    // 注意：自动保存不能取消在途补全请求——DeepSeek 响应慢于 800ms 防抖，
    // 取消会中止幽灵文本。真正需要取消的是切页/关页（switchTo/close 已处理）。
    const doc = this.handle.view.state.doc.toString();
    const state = this.handle.view.state;
    tab.dirty = false;
    try {
      if (tab.kind === 'doc') {
        await this.opts.saveDoc(tab.docKind!, tab.docId!, doc);
      } else {
        await this.opts.saveChapter(tab.chapterId!, doc);
      }
      tab.savedState = state;
      this.opts.onTabsChange();
      this.opts.onActiveChange();
    } catch {
      tab.dirty = true;
      this.opts.onActiveChange();
    }
  }

  async requestSuggestionForActive(
    req: { textBefore: string; textAfter: string; signal: AbortSignal },
  ): Promise<string> {
    const tab = this.active;
    if (!tab || tab.kind !== 'chapter') return '';
    return this.opts.requestSuggestion(req, tab.chapterId!);
  }

  private applyState(state: EditorState): void {
    this.isSwitching = true;
    try {
      this.handle.view.setState(state);
    } finally {
      this.isSwitching = false;
    }
  }
}
