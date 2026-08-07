import { Router } from 'express';
import {
  listKindDocs,
  getDoc,
  getStyleDoc,
  createDoc,
  writeDoc,
  deleteDoc,
  findDoc,
} from '../fs/docFs.js';
import type { DocRow } from '../types.js';

// 人物卡/世界观/伏笔/文风 已迁到 .docs/<类>/*.md 文件，这里读写文件、返回 JSON 形状与旧表完全一致（客户端零改动）。
// 注意：老路由的 PUT/DELETE 只带 id（不带 novelId），故用 findDoc 反查所属小说。

export const manageRouter = Router();

// ---------- 人物卡 ----------

function characterShape(d: DocRow) {
  return {
    id: d.id,
    novel_id: d.novel_id,
    name: String(d.fields.name ?? ''),
    profile: String(d.fields.profile ?? ''),
    speaking_style: String(d.fields.speaking_style ?? ''),
    status: String(d.fields.status ?? ''),
    main: String(d.fields.main ?? '') === '1',
  };
}

/** body 里 main 的布尔/字符串归一化成 "1" 或空串（空串会被 writeDoc 删除字段） */
function mainFlag(v: unknown): string {
  return v === true || v === '1' || v === 1 ? '1' : '';
}

manageRouter.get('/characters', (req, res) => {
  const novelId = Number(req.query.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  res.json(listKindDocs(novelId, 'characters').map(characterShape));
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
  const doc = createDoc(novelId, 'characters', name);
  const updated = writeDoc(doc, {
    fields: { profile, speaking_style: speakingStyle, status, main: mainFlag(req.body?.main) },
  });
  res.status(201).json(characterShape(updated));
});

manageRouter.put('/characters/:id', (req, res) => {
  const id = Number(req.params.id);
  const hit = findDoc('characters', id);
  if (!hit) {
    res.status(404).json({ error: '人物不存在' });
    return;
  }
  const existing = hit.doc;
  const name =
    req.body?.name !== undefined ? String(req.body.name) : String(existing.fields.name ?? '');
  const profile =
    req.body?.profile !== undefined ? String(req.body.profile) : String(existing.fields.profile ?? '');
  const speakingStyle =
    req.body?.speakingStyle !== undefined
      ? String(req.body.speakingStyle)
      : String(existing.fields.speaking_style ?? '');
  const status =
    req.body?.status !== undefined ? String(req.body.status) : String(existing.fields.status ?? '');
  const main =
    req.body?.main !== undefined
      ? mainFlag(req.body.main)
      : String(existing.fields.main ?? '');
  const updated = writeDoc(existing, {
    fields: { name, profile, speaking_style: speakingStyle, status, main },
    title: name, // 改名联动文件名
  });
  res.json(characterShape(updated));
});

manageRouter.delete('/characters/:id', async (req, res) => {
  const id = Number(req.params.id);
  const hit = findDoc('characters', id);
  if (!hit) {
    res.status(404).json({ error: '人物不存在' });
    return;
  }
  await deleteDoc(hit.novelId, 'characters', id);
  res.status(204).end();
});

// ---------- 世界观 ----------

function settingShape(d: DocRow) {
  return {
    id: d.id,
    novel_id: d.novel_id,
    key: String(d.fields.key ?? ''),
    value: String(d.fields.value ?? ''),
  };
}

manageRouter.get('/world-settings', (req, res) => {
  const novelId = Number(req.query.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  res.json(listKindDocs(novelId, 'world').map(settingShape));
});

manageRouter.post('/world-settings', (req, res) => {
  const novelId = Number(req.body?.novelId);
  const key = String(req.body?.key ?? '').trim();
  if (!novelId || !key) {
    res.status(400).json({ error: 'novelId 与 key 必填' });
    return;
  }
  const value = String(req.body?.value ?? '');
  const doc = createDoc(novelId, 'world', key);
  const updated = writeDoc(doc, { fields: { value } });
  res.status(201).json(settingShape(updated));
});

manageRouter.put('/world-settings/:id', (req, res) => {
  const id = Number(req.params.id);
  const hit = findDoc('world', id);
  if (!hit) {
    res.status(404).json({ error: '设定不存在' });
    return;
  }
  const existing = hit.doc;
  const key =
    req.body?.key !== undefined ? String(req.body.key) : String(existing.fields.key ?? '');
  const value =
    req.body?.value !== undefined ? String(req.body.value) : String(existing.fields.value ?? '');
  const updated = writeDoc(existing, {
    fields: { key, value },
    title: key, // 改名联动文件名
  });
  res.json(settingShape(updated));
});

manageRouter.delete('/world-settings/:id', async (req, res) => {
  const id = Number(req.params.id);
  const hit = findDoc('world', id);
  if (!hit) {
    res.status(404).json({ error: '设定不存在' });
    return;
  }
  await deleteDoc(hit.novelId, 'world', id);
  res.status(204).end();
});

// ---------- 伏笔 ----------

function foreshadowShape(d: DocRow) {
  return {
    id: d.id,
    novel_id: d.novel_id,
    planted_chapter: (d.fields.planted_chapter as number | null | undefined) ?? null,
    resolved_chapter: (d.fields.resolved_chapter as number | null | undefined) ?? null,
    note: String(d.fields.note ?? ''),
  };
}

manageRouter.get('/foreshadowing', (req, res) => {
  const novelId = Number(req.query.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  res.json(listKindDocs(novelId, 'foreshadow').map(foreshadowShape));
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
  const doc = createDoc(novelId, 'foreshadow');
  const updated = writeDoc(doc, {
    fields: { note, planted_chapter: planted, resolved_chapter: resolved },
  });
  res.status(201).json(foreshadowShape(updated));
});

manageRouter.put('/foreshadowing/:id', (req, res) => {
  const id = Number(req.params.id);
  const hit = findDoc('foreshadow', id);
  if (!hit) {
    res.status(404).json({ error: '伏笔不存在' });
    return;
  }
  const existing = hit.doc;
  const planted =
    req.body?.plantedChapter !== undefined
      ? (Number(req.body.plantedChapter) || null)
      : (existing.fields.planted_chapter as number | null | undefined) ?? null;
  const resolved =
    req.body?.resolvedChapter !== undefined
      ? (Number(req.body.resolvedChapter) || null)
      : (existing.fields.resolved_chapter as number | null | undefined) ?? null;
  const note =
    req.body?.note !== undefined ? String(req.body.note) : String(existing.fields.note ?? '');
  const updated = writeDoc(existing, {
    fields: { note, planted_chapter: planted, resolved_chapter: resolved },
  });
  res.json(foreshadowShape(updated));
});

manageRouter.delete('/foreshadowing/:id', async (req, res) => {
  const id = Number(req.params.id);
  const hit = findDoc('foreshadow', id);
  if (!hit) {
    res.status(404).json({ error: '伏笔不存在' });
    return;
  }
  await deleteDoc(hit.novelId, 'foreshadow', id);
  res.status(204).end();
});

// ---------- 文风档案（每部小说单例） ----------

function styleShape(d: DocRow) {
  return {
    id: d.id,
    novel_id: d.novel_id,
    voice: String(d.fields.voice ?? ''),
    rhythm_notes: String(d.fields.rhythm_notes ?? ''),
    taboo_words: String(d.fields.taboo_words ?? ''),
  };
}

manageRouter.get('/style-profile', (req, res) => {
  const novelId = Number(req.query.novelId);
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  const doc = getStyleDoc(novelId);
  if (!doc) {
    res.json({ id: null, novel_id: novelId, voice: '', rhythm_notes: '', taboo_words: '' });
    return;
  }
  res.json(styleShape(doc));
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
  const existing = getStyleDoc(novelId);
  const doc = existing ?? createDoc(novelId, 'style');
  const updated = writeDoc(doc, {
    fields: { voice, rhythm_notes: rhythmNotes, taboo_words: tabooWords },
  });
  res.json(styleShape(updated));
});
