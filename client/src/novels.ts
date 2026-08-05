import { api, type Novel, type Chapter } from './api';
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
  openFirstChapter();
}

export function openFirstChapter(): void {
  const novel = app.currentNovel;
  if (!novel || novel.chapters.length === 0) return;
  app.tabs?.openChapter(novel.chapters[0]);
}

export async function createNovel(title: string): Promise<Novel> {
  const novel = await api.createNovel(title);
  await reloadNovels();
  await selectNovel(novel.id);
  return novel;
}

export async function createChapter(title: string): Promise<Chapter> {
  const novelId = app.currentNovel?.id;
  if (!novelId) throw new Error('未选择小说');
  const count = app.currentNovel!.chapters.length;
  const chapter = await api.createChapter(novelId, title.trim() || `第 ${count + 1} 章`);
  await reloadNovel();
  app.tabs?.openChapter(chapter);
  return chapter;
}

export async function renameChapter(chapter: Chapter, title: string): Promise<Chapter> {
  const updated = await api.saveChapter(chapter.id, { title: title.trim() });
  patchChapter(updated);
  app.tabs?.updateFromChapter(updated);
  await reloadNovel();
  return updated;
}

export async function deleteChapter(id: number): Promise<void> {
  if (app.tabs?.has(id)) await app.tabs.close(id);
  await api.deleteChapter(id);
  await reloadNovel();
}
