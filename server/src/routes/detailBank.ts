import { Router } from 'express';
import {
  listKindDocs,
  getDoc,
  createDoc,
  writeDoc,
  deleteDoc,
  findDoc,
  upsertBankMirror,
  removeBankMirror,
} from '../fs/docFs.js';
import { searchDetailBank, extractTerms } from '../ai/detailBank.js';
import type { DocRow } from '../types.js';

// 素材库以 .docs/素材库/*.md 为唯一事实源（content=正文）；写文件后同步 detail_bank mirror 行（FTS 触发器维护检索）。
// 搜索走原 searchDetailBank（查 mirror），返回形状与旧表一致。

export const detailBankRouter = Router();

function bankShape(d: DocRow) {
  return {
    id: d.id,
    novel_id: d.novel_id,
    scene_type: String(d.fields.scene_type ?? ''),
    sensory_channel: String(d.fields.sensory_channel ?? ''),
    content: d.body,
    tags: String(d.fields.tags ?? ''),
  };
}

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
  // 旧接口按 id DESC（最新在前）
  res.json(listKindDocs(novelId, 'bank').reverse().map(bankShape));
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
  const doc = createDoc(novelId, 'bank');
  const updated = writeDoc(doc, {
    fields: { scene_type: sceneType, sensory_channel: sensoryChannel, tags },
    body: content,
  });
  upsertBankMirror(updated);
  res.status(201).json(bankShape(updated));
});

detailBankRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const hit = findDoc('bank', id);
  if (!hit) {
    res.status(404).json({ error: '素材不存在' });
    return;
  }
  const patch = req.body ?? {};
  const existing = hit.doc;
  const fields: Record<string, string | number | null> = {};
  if (patch.sceneType != null) fields.scene_type = String(patch.sceneType).trim();
  if (patch.sensoryChannel != null) fields.sensory_channel = String(patch.sensoryChannel).trim();
  if (patch.tags != null) fields.tags = String(patch.tags).trim();
  const updated = writeDoc(existing, {
    fields,
    body: patch.content != null ? String(patch.content).trim() : undefined,
  });
  upsertBankMirror(updated);
  res.json(bankShape(updated));
});

detailBankRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const hit = findDoc('bank', id);
  if (!hit) {
    res.status(404).json({ error: '素材不存在' });
    return;
  }
  await deleteDoc(hit.novelId, 'bank', id);
  removeBankMirror(id);
  res.status(204).end();
});

detailBankRouter.get('/suggest', (req, res) => {
  const q = String(req.query.q ?? '');
  res.json(extractTerms(q));
});
