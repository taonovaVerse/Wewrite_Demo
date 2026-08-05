import { Router } from 'express';
import { db } from '../db.js';

export const chaptersRouter = Router();

interface ChapterRow {
  id: number;
  novel_id: number;
  order_idx: number;
  title: string;
  content: string;
  blueprint: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const getChapterStmt = db.prepare('SELECT * FROM chapters WHERE id = ?');
const updateChapterStmt = db.prepare(`
  UPDATE chapters
  SET title = ?, content = ?, blueprint = ?, status = ?,
      updated_at = datetime('now')
  WHERE id = ?
`);
const deleteChapterStmt = db.prepare('DELETE FROM chapters WHERE id = ?');
const touchNovelStmt = db.prepare(
  "UPDATE novels SET updated_at = datetime('now') WHERE id = ?"
);

chaptersRouter.get('/:id', (req, res) => {
  const chapter = getChapterStmt.get(Number(req.params.id)) as ChapterRow | undefined;
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }
  res.json(chapter);
});

chaptersRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getChapterStmt.get(id) as ChapterRow | undefined;
  if (!existing) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }
  const title = req.body?.title !== undefined ? String(req.body.title) : existing.title;
  const content = req.body?.content !== undefined ? String(req.body.content) : existing.content;
  const blueprint =
    req.body?.blueprint !== undefined ? String(req.body.blueprint) : existing.blueprint;
  const status = req.body?.status !== undefined ? String(req.body.status) : existing.status;

  updateChapterStmt.run(title, content, blueprint, status, id);
  touchNovelStmt.run(existing.novel_id);
  res.json(getChapterStmt.get(id) as ChapterRow);
});

chaptersRouter.delete('/:id', (req, res) => {
  const chapter = getChapterStmt.get(Number(req.params.id)) as ChapterRow | undefined;
  if (!chapter) {
    res.status(404).json({ error: '章节不存在' });
    return;
  }
  deleteChapterStmt.run(chapter.id);
  touchNovelStmt.run(chapter.novel_id);
  res.status(204).end();
});
