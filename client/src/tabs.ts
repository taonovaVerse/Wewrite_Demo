import { EditorState } from '@codemirror/state';
import type { EditorHandle } from './editor';
import type { Chapter } from './api';

export interface TabData {
  chapterId: number;
  title: string;
  orderIdx: number;
  dirty: boolean;
  savedState: EditorState;
}

export interface TabManagerOptions {
  saveChapter: (chapterId: number, content: string) => Promise<void>;
  requestSuggestion: (
    req: { textBefore: string; textAfter: string; signal: AbortSignal },
    chapterId: number,
  ) => Promise<string>;
  onTabsChange: () => void;
  onActiveChange: () => void;
}

export class TabManager {
  activeId: number | null = null;
  isSwitching = false;

  private tabs = new Map<number, TabData>();
  private saveTimer: number | undefined;

  constructor(
    private handle: EditorHandle,
    private opts: TabManagerOptions,
  ) {}

  get count(): number {
    return this.tabs.size;
  }

  has(id: number): boolean {
    return this.tabs.has(id);
  }

  get active(): TabData | null {
    return this.activeId == null ? null : (this.tabs.get(this.activeId) ?? null);
  }

  all(): TabData[] {
    return [...this.tabs.values()];
  }

  openChapter(chapter: Chapter): void {
    if (this.tabs.has(chapter.id)) {
      this.switchTo(chapter.id);
      return;
    }
    const state = this.handle.createState(chapter.content);
    this.tabs.set(chapter.id, {
      chapterId: chapter.id,
      title: chapter.title,
      orderIdx: chapter.order_idx,
      dirty: false,
      savedState: state,
    });
    this.switchTo(chapter.id);
  }

  switchTo(id: number): void {
    const next = this.tabs.get(id);
    if (!next || id === this.activeId) return;
    this.handle.cancelSuggestion();
    void this.flushActive();
    this.applyState(next.savedState);
    this.activeId = id;
    this.opts.onActiveChange();
    this.opts.onTabsChange();
  }

  async close(id: number): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (id === this.activeId) {
      this.handle.cancelSuggestion();
      await this.flushActive();
      if (!this.tabs.has(id)) return;
      this.tabs.delete(id);
      if (this.activeId === id) {
        this.activeId = null;
        const remaining = [...this.tabs.values()];
        if (remaining.length > 0) {
          const next = remaining[0];
          this.applyState(next.savedState);
          this.activeId = next.chapterId;
        } else {
          this.applyState(this.handle.createState('', true));
        }
      }
      this.opts.onActiveChange();
      this.opts.onTabsChange();
    } else {
      this.tabs.delete(id);
      this.opts.onTabsChange();
    }
  }

  async closeAll(): Promise<void> {
    if (this.activeId != null) {
      this.handle.cancelSuggestion();
      await this.flushActive();
    }
    this.tabs.clear();
    this.activeId = null;
    this.applyState(this.handle.createState('', true));
    this.opts.onActiveChange();
    this.opts.onTabsChange();
  }

  rename(id: number, title: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.title = title;
    this.opts.onTabsChange();
  }

  updateFromChapter(ch: Chapter): void {
    const tab = this.tabs.get(ch.id);
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
    this.handle.cancelSuggestion();
    const doc = this.handle.view.state.doc.toString();
    const state = this.handle.view.state;
    tab.dirty = false;
    try {
      await this.opts.saveChapter(tab.chapterId, doc);
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
    const id = this.activeId;
    if (id == null) return '';
    return this.opts.requestSuggestion(req, id);
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
