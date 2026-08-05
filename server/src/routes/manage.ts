import { Router } from 'express';
import { db } from '../db.js';

export const manageRouter = Router();

// ---------- 人物卡 ----------

const listCharactersStmt = db.prepare('SELECT * FROM characters WHERE novel_id = ? ORDER BY id');
const insertCharacterStmt = db.prepare(
  `INSERT INTO characters (novel_id, name, profile, speaking_style, status)
   VALUES (?, ?, ?, ?, ?)`
);
const getCharacterStmt = db.prepare('SELECT * FROM characters WHERE id = ?');
const updateCharacterStmt = db.prepare(
  'UPDATE characters SET name = ?, profile = ?, speaking_style = ?, status = ? WHERE id = ?'
);
const deleteCharacterStmt = db.prepare('DELETE FROM characters WHERE id = ?');

manageRouter.get('/characters', (req, res) => {
  const novelId = Number(req.query.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  res.json(listCharactersStmt.all(novelId));
});

manageRouter.post('/characters', (req, res) => {
  const novelId = Number(req.body?.novelId);
  const name = String(req.body?.name ?? '').trim();
  if (!novelId || !name) {
    res.status(400).json({ error: 'novelId 与 name 必填' });
    return;
  }
  const profile = String(req.body?.profile ?? '');
  const speakingStyle = String(req.body?.speakingStyle ?? '');
  const status = String(req.body?.status ?? '');
  const result = insertCharacterStmt.run(novelId, name, profile, speakingStyle, status);
  res.status(201).json(getCharacterStmt.get(result.lastInsertRowid));
});

manageRouter.put('/characters/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getCharacterStmt.get(id) as
    | { name: string; profile: string; speaking_style: string; status: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: '人物不存在' });
    return;
  }
  const name = req.body?.name !== undefined ? String(req.body.name) : existing.name;
  const profile = req.body?.profile !== undefined ? String(req.body.profile) : existing.profile;
  const speakingStyle =
    req.body?.speakingStyle !== undefined
      ? String(req.body.speakingStyle)
      : existing.speaking_style;
  const status = req.body?.status !== undefined ? String(req.body.status) : existing.status;
  updateCharacterStmt.run(name, profile, speakingStyle, status, id);
  res.json(getCharacterStmt.get(id));
});

manageRouter.delete('/characters/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getCharacterStmt.get(id)) {
    res.status(404).json({ error: '人物不存在' });
    return;
  }
  deleteCharacterStmt.run(id);
  res.status(204).end();
});

// ---------- 世界观 ----------

const listSettingsStmt = db.prepare('SELECT * FROM world_settings WHERE novel_id = ? ORDER BY id');
const insertSettingStmt = db.prepare('INSERT INTO world_settings (novel_id, key, value) VALUES (?, ?, ?)');
const getSettingStmt = db.prepare('SELECT * FROM world_settings WHERE id = ?');
const updateSettingStmt = db.prepare('UPDATE world_settings SET key = ?, value = ? WHERE id = ?');
const deleteSettingStmt = db.prepare('DELETE FROM world_settings WHERE id = ?');

manageRouter.get('/world-settings', (req, res) => {
  const novelId = Number(req.query.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  res.json(listSettingsStmt.all(novelId));
});

manageRouter.post('/world-settings', (req, res) => {
  const novelId = Number(req.body?.novelId);
  const key = String(req.body?.key ?? '').trim();
  if (!novelId || !key) {
    res.status(400).json({ error: 'novelId 与 key 必填' });
    return;
  }
  const value = String(req.body?.value ?? '');
  const result = insertSettingStmt.run(novelId, key, value);
  res.status(201).json(getSettingStmt.get(result.lastInsertRowid));
});

manageRouter.put('/world-settings/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getSettingStmt.get(id) as { key: string; value: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: '设定不存在' });
    return;
  }
  const key = req.body?.key !== undefined ? String(req.body.key) : existing.key;
  const value = req.body?.value !== undefined ? String(req.body.value) : existing.value;
  updateSettingStmt.run(key, value, id);
  res.json(getSettingStmt.get(id));
});

manageRouter.delete('/world-settings/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getSettingStmt.get(id)) {
    res.status(404).json({ error: '设定不存在' });
    return;
  }
  deleteSettingStmt.run(id);
  res.status(204).end();
});

// ---------- 伏笔 ----------

const listForeshadowStmt = db.prepare('SELECT * FROM foreshadowing WHERE novel_id = ? ORDER BY id');
const insertForeshadowStmt = db.prepare(
  'INSERT INTO foreshadowing (novel_id, planted_chapter, resolved_chapter, note) VALUES (?, ?, ?, ?)'
);
const getForeshadowStmt = db.prepare('SELECT * FROM foreshadowing WHERE id = ?');
const updateForeshadowStmt = db.prepare(
  'UPDATE foreshadowing SET planted_chapter = ?, resolved_chapter = ?, note = ? WHERE id = ?'
);
const deleteForeshadowStmt = db.prepare('DELETE FROM foreshadowing WHERE id = ?');

manageRouter.get('/foreshadowing', (req, res) => {
  const novelId = Number(req.query.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  res.json(listForeshadowStmt.all(novelId));
});

manageRouter.post('/foreshadowing', (req, res) => {
  const novelId = Number(req.body?.novelId);
  const note = String(req.body?.note ?? '').trim();
  if (!novelId || !note) {
    res.status(400).json({ error: 'novelId 与 note 必填' });
    return;
  }
  const planted = req.body?.plantedChapter != null ? Number(req.body.plantedChapter) : null;
  const resolved = req.body?.resolvedChapter != null ? Number(req.body.resolvedChapter) : null;
  const result = insertForeshadowStmt.run(novelId, planted, resolved, note);
  res.status(201).json(getForeshadowStmt.get(result.lastInsertRowid));
});

manageRouter.put('/foreshadowing/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getForeshadowStmt.get(id) as
    | { planted_chapter: number | null; resolved_chapter: number | null; note: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: '伏笔不存在' });
    return;
  }
  const planted =
    req.body?.plantedChapter !== undefined
      ? (Number(req.body.plantedChapter) || null)
      : existing.planted_chapter;
  const resolved =
    req.body?.resolvedChapter !== undefined
      ? (Number(req.body.resolvedChapter) || null)
      : existing.resolved_chapter;
  const note = req.body?.note !== undefined ? String(req.body.note) : existing.note;
  updateForeshadowStmt.run(planted, resolved, note, id);
  res.json(getForeshadowStmt.get(id));
});

manageRouter.delete('/foreshadowing/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getForeshadowStmt.get(id)) {
    res.status(404).json({ error: '伏笔不存在' });
    return;
  }
  deleteForeshadowStmt.run(id);
  res.status(204).end();
});

// ---------- 文风档案（每部小说一条，按 novelId 取或建） ----------

const getStyleStmt = db.prepare('SELECT * FROM style_profiles WHERE novel_id = ?');
const insertStyleStmt = db.prepare(
  'INSERT INTO style_profiles (novel_id, voice, rhythm_notes, taboo_words) VALUES (?, ?, ?, ?)'
);
const updateStyleStmt = db.prepare(
  'UPDATE style_profiles SET voice = ?, rhythm_notes = ?, taboo_words = ? WHERE novel_id = ?'
);

manageRouter.get('/style-profile', (req, res) => {
  const novelId = Number(req.query.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  const row = getStyleStmt.get(novelId) as
    | { id: number; novel_id: number; voice: string; rhythm_notes: string; taboo_words: string }
    | undefined;
  if (!row) {
    res.json({ id: null, novel_id: novelId, voice: '', rhythm_notes: '', taboo_words: '' });
    return;
  }
  res.json(row);
});

manageRouter.put('/style-profile', (req, res) => {
  const novelId = Number(req.body?.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  const voice = String(req.body?.voice ?? '');
  const rhythmNotes = String(req.body?.rhythmNotes ?? '');
  const tabooWords = String(req.body?.tabooWords ?? '');
  const existing = getStyleStmt.get(novelId);
  if (existing) {
    updateStyleStmt.run(voice, rhythmNotes, tabooWords, novelId);
  } else {
    insertStyleStmt.run(novelId, voice, rhythmNotes, tabooWords);
  }
  res.json(getStyleStmt.get(novelId));
});
