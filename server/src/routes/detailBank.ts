import { Router } from 'express';
import { db } from '../db.js';
import { searchDetailBank, extractTerms } from '../ai/detailBank.js';

export const detailBankRouter = Router();

const listStmt = db.prepare(
  'SELECT * FROM detail_bank WHERE novel_id = ? ORDER BY id DESC'
);
const insertStmt = db.prepare(
  `INSERT INTO detail_bank (novel_id, scene_type, sensory_channel, content, tags)
   VALUES (?, ?, ?, ?, ?)`
);
const getStmt = db.prepare('SELECT * FROM detail_bank WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM detail_bank WHERE id = ?');
const updateStmt = db.prepare(
  `UPDATE detail_bank
   SET scene_type = COALESCE(?, scene_type),
       sensory_channel = COALESCE(?, sensory_channel),
       content = COALESCE(?, content),
       tags = COALESCE(?, tags)
   WHERE id = ?`
);

detailBankRouter.get('/', (req, res) => {
  const novelId = Number(req.query.novelId);
  const q = String(req.query.q ?? '');
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  if (q.trim()) {
    res.json(searchDetailBank(novelId, q, 50));
    return;
  }
  res.json(listStmt.all(novelId));
});

detailBankRouter.post('/', (req, res) => {
  const novelId = Number(req.body?.novelId);
  const content = String(req.body?.content ?? '').trim();
  if (!novelId || !content) {
    res.status(400).json({ error: 'novelId 与 content 必填' });
    return;
  }
  const sceneType = String(req.body?.sceneType ?? '').trim();
  const sensoryChannel = String(req.body?.sensoryChannel ?? '').trim();
  const tags = String(req.body?.tags ?? '').trim();
  const result = insertStmt.run(novelId, sceneType, sensoryChannel, content, tags);
  res.status(201).json(getStmt.get(result.lastInsertRowid));
});

detailBankRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getStmt.get(id);
  if (!existing) {
    res.status(404).json({ error: '素材不存在' });
    return;
  }
  const patch = req.body ?? {};
  updateStmt.run(
    patch.sceneType != null ? String(patch.sceneType).trim() : null,
    patch.sensoryChannel != null ? String(patch.sensoryChannel).trim() : null,
    patch.content != null ? String(patch.content).trim() : null,
    patch.tags != null ? String(patch.tags).trim() : null,
    id,
  );
  res.json(getStmt.get(id));
});

detailBankRouter.delete('/:id', (req, res) => {
  const existing = getStmt.get(Number(req.params.id));
  if (!existing) {
    res.status(404).json({ error: '素材不存在' });
    return;
  }
  deleteStmt.run(Number(req.params.id));
  res.status(204).end();
});

detailBankRouter.get('/suggest', (req, res) => {
  const q = String(req.query.q ?? '');
  res.json(extractTerms(q));
});
