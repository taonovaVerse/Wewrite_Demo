import { Router } from 'express';
import {
  getChapterById,
  writeChapter,
  deleteChapter,
  renameFileToTitle,
} from '../fs/novelFs.js';
import { touchNovel } from '../fs/registry.js';
import { scheduleSnapshot, snapshotNow } from '../fs/versioning.js';
import { parseSceneCharacterIds, type ChapterRow } from '../types.js';

export const chaptersRouter = Router();

/** 请求里的「在场人物」（人物 id 数组或逗号分隔字符串）归一成逗号分隔字符串 */
function normalizeSceneCharacters(raw: unknown): string {
  let s: string;
  if (Array.isArray(raw)) s = raw.join(',');
  else if (typeof raw === 'string') s = raw;
  else s = '';
  return parseSceneCharacterIds(s).join(',');
}

chaptersRouter.get('/:id', (req, res) => {
  const chapter = getChapterById(Number(req.params.id));
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }
  res.json(chapter);
});

chaptersRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getChapterById(id);
  if (!existing) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }
  const title = req.body?.title !== undefined ? String(req.body.title) : existing.title;
  const content = req.body?.content !== undefined ? String(req.body.content) : existing.content;
  const blueprint =
    req.body?.blueprint !== undefined ? String(req.body.blueprint) : existing.blueprint;
  const location =
    req.body?.location !== undefined ? String(req.body.location) : existing.location;
  const timeFrame =
    req.body?.timeFrame !== undefined ? String(req.body.timeFrame) : existing.time_frame;
  const emotion =
    req.body?.emotion !== undefined ? String(req.body.emotion) : existing.emotion;
  const theme = req.body?.theme !== undefined ? String(req.body.theme) : existing.theme;
  const sceneCharacters =
    req.body?.sceneCharacters !== undefined
      ? normalizeSceneCharacters(req.body.sceneCharacters)
      : existing.scene_characters;
  const status = req.body?.status !== undefined ? String(req.body.status) : existing.status;

  const merged: ChapterRow = {
    ...existing,
    title,
    content,
    blueprint,
    location,
    time_frame: timeFrame,
    emotion,
    theme,
    scene_characters: sceneCharacters,
    status,
  };
  // 标题变化时同步重命名 .md 文件名
  if (title !== existing.title) renameFileToTitle(merged);
  writeChapter(merged);
  touchNovel(existing.novel_id);
  scheduleSnapshot(existing.novel_id);
  res.json(getChapterById(id) ?? merged);
});

chaptersRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const chapter = getChapterById(id);
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }
  try {
    await deleteChapter(chapter.novel_id, id);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '删除失败' });
    return;
  }
  touchNovel(chapter.novel_id);
  void snapshotNow(chapter.novel_id);
  res.status(204).end();
});
