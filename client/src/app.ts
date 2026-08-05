import type { Novel, NovelDetail, Chapter } from './api';
import type { EditorHandle } from './editor';
import type { TabManager } from './tabs';

export const app = {
  novels: [] as Novel[],
  currentNovel: null as NovelDetail | null,
  editor: null as EditorHandle | null,
  tabs: null as TabManager | null,
  generating: false,
  abortCtrl: null as AbortController | null,
};

export function activeChapterId(): number | null {
  return app.tabs?.activeId ?? null;
}

export function activeChapter(): Chapter | null {
  const id = activeChapterId();
  if (id == null || !app.currentNovel) return null;
  return app.currentNovel.chapters.find((c) => c.id === id) ?? null;
}

/** 用服务端返回的章节数据更新 currentNovel 里的对应条目 */
export function patchChapter(updated: Chapter): void {
  if (!app.currentNovel) return;
  app.currentNovel = {
    ...app.currentNovel,
    chapters: app.currentNovel.chapters.map((c) => (c.id === updated.id ? updated : c)),
  };
}
