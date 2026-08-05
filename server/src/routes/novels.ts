import { Router } from 'express';
import { db } from '../db.js';

export const novelsRouter = Router();

interface NovelRow {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

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

const listNovelsStmt = db.prepare(
  'SELECT id, title, created_at, updated_at FROM novels ORDER BY updated_at DESC'
);
const getNovelStmt = db.prepare('SELECT * FROM novels WHERE id = ?');
const insertNovelStmt = db.prepare('INSERT INTO novels (title) VALUES (?)');
const listChaptersStmt = db.prepare(
  'SELECT * FROM chapters WHERE novel_id = ? ORDER BY order_idx, id'
);
const insertChapterStmt = db.prepare(
  'INSERT INTO chapters (novel_id, order_idx, title) VALUES (?, ?, ?)'
);
const maxOrderStmt = db.prepare(
  'SELECT COALESCE(MAX(order_idx), 0) AS m FROM chapters WHERE novel_id = ?'
);
const touchNovelStmt = db.prepare(
  "UPDATE novels SET updated_at = datetime('now') WHERE id = ?"
);

novelsRouter.get('/', (_req, res) => {
  res.json(listNovelsStmt.all() as NovelRow[]);
});

novelsRouter.post('/', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) {
    res.status(400).json({ error: 'title 不能为空' });
    return;
  }
  const result = insertNovelStmt.run(title);
  const novel = getNovelStmt.get(result.lastInsertRowid) as NovelRow;
  res.status(201).json(novel);
});

novelsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const novel = getNovelStmt.get(id) as NovelRow | undefined;
  if (!novel) {
    res.status(404).json({ error: '小说不存在' });
    return;
  }
  const chapters = listChaptersStmt.all(id) as ChapterRow[];
  res.json({ ...novel, chapters });
});

novelsRouter.post('/:id/chapters', (req, res) => {
  const novelId = Number(req.params.id);
  if (!getNovelStmt.get(novelId)) {
    res.status(404).json({ error: '小说不存在' });
    return;
  }
  const title = String(req.body?.title ?? '未命名章节');
  const { m } = maxOrderStmt.get(novelId) as { m: number };
  const result = insertChapterStmt.run(novelId, m + 1, title);
  touchNovelStmt.run(novelId);
  const chapter = db
    .prepare('SELECT * FROM chapters WHERE id = ?')
    .get(result.lastInsertRowid) as ChapterRow;
  res.status(201).json(chapter);
});
