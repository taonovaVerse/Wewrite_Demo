import { api, type Novel, type Chapter, type DocKind, type DocRow } from './api';
import { app, patchChapter } from './app';

export async function reloadNovels(): Promise<void> {
  app.novels = await api.novels();
}

export async function reloadNovel(): Promise<void> {
  if (!app.currentNovel) return;
  app.currentNovel = await api.novel(app.currentNovel.id);
}

export async function selectNovel(id: number): Promise<void> {
  await app.tabs?.closeAll();
  app.currentNovel = await api.novel(id);
}

export async function createNovel(title: string): Promise<Novel> {
  const novel = await api.createNovel(title);
  await reloadNovels();
  await selectNovel(novel.id);
  return novel;
}

/** 打开外部文件夹为小说，成功即选中 */
export async function openNovelFolder(path: string): Promise<Novel> {
  const novel = await api.openNovelFolder(path);
  await reloadNovels();
  await selectNovel(novel.id);
  return novel;
}

/** 重命名小说；若重命名的是当前小说则同时刷新详情（侧边栏/状态栏标题） */
export async function renameNovel(id: number, title: string): Promise<void> {
  await api.renameNovel(id, title.trim());
  await reloadNovels();
  if (app.currentNovel?.id === id) await reloadNovel();
}

/** 删除小说：若正在打开先关全部标签并清当前小说，再调 API */
export async function deleteNovel(id: number): Promise<void> {
  if (app.currentNovel?.id === id) {
    await app.tabs?.closeAll();
    app.currentNovel = null;
  }
  await api.deleteNovel(id);
  await reloadNovels();
}

export async function createChapter(title: string, folder = ''): Promise<Chapter> {
  const novelId = app.currentNovel?.id;
  if (!novelId) throw new Error('未选择小说');
  const count = app.currentNovel!.chapters.length;
  const chapter = await api.createChapter(novelId, title.trim() || `第 ${count + 1} 章`, folder);
  await reloadNovel();
  app.tabs?.openChapter(chapter);
  return chapter;
}

/** 移动章节到目标文件夹（可插到 beforeId 之前）；服务端重排源/目标兄弟 order */
export async function moveChapter(
  chapterId: number,
  folder: string,
  beforeId?: number,
): Promise<void> {
  const novelId = app.currentNovel?.id;
  if (!novelId) throw new Error('未选择小说');
  await api.moveChapter({ novelId, chapterId, folder, beforeId });
  await reloadNovel();
}

export async function renameChapter(chapter: Chapter, title: string): Promise<Chapter> {
  const updated = await api.saveChapter(chapter.id, { title: title.trim() });
  patchChapter(updated);
  app.tabs?.updateFromChapter(updated);
  await reloadNovel();
  return updated;
}

export async function deleteChapter(id: number): Promise<void> {
  if (app.tabs?.hasChapter(id)) await app.tabs.closeChapter(id);
  await api.deleteChapter(id);
  await reloadNovel();
}

/** 新建世界文档（人物卡/世界观带 title 作名称，其余直接建空记录） */
export async function createDoc(kind: DocKind, title?: string): Promise<DocRow> {
  const novelId = app.currentNovel?.id;
  if (!novelId) throw new Error('未选择小说');
  const doc = await api.createDoc({ novelId, kind, title });
  await reloadNovel();
  return doc;
}

/** 删除世界文档；若在编辑器里打开则先关 tab */
export async function deleteDoc(kind: DocKind, id: number): Promise<void> {
  const novelId = app.currentNovel?.id;
  if (novelId == null) throw new Error('未选择小说');
  const active = app.tabs?.active;
  if (active?.kind === 'doc' && active.docKind === kind && active.docId === id) {
    await app.tabs?.closeDoc(kind, id);
  }
  await api.deleteDoc(novelId, kind, id);
  await reloadNovel();
}
