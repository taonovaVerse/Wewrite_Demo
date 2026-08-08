import { Router } from 'express';
import { listKindDocs, getDoc, createDoc, writeDoc, deleteDoc, DOC_KINDS } from '../fs/docFs.js';
import { scheduleSnapshot, snapshotNow } from '../fs/versioning.js';
import type { DocKind } from '../types.js';

// 编辑器专用文档路由：把世界文档（人物卡/世界观/伏笔/文风/素材库）作为可编辑文件打开。
// 路径形如 /api/docs/<kind>/<id>，novelId 在 GET/DELETE 走 query、PUT/POST 走 body。

export const docsRouter = Router();

const KINDS = Object.keys(DOC_KINDS) as DocKind[];

function parseKind(s: string): DocKind | undefined {
  return KINDS.find((k) => k === s);
}

// 列出某类文档
docsRouter.get('/', (req, res) => {
  const novelId = Number(req.query.novelId);
  const kind = parseKind(String(req.query.kind ?? ''));
  if (!novelId) {
    res.status(400).json({ error: '缺少 novelId' });
    return;
  }
  if (!kind) {
    res.status(400).json({ error: '未知文档类型' });
    return;
  }
  res.json(listKindDocs(novelId, kind));
});

// 取单个文档
docsRouter.get('/:kind/:id', (req, res) => {
  const novelId = Number(req.query.novelId);
  const kind = parseKind(req.params.kind);
  const id = Number(req.params.id);
  if (!novelId || !kind || !id) {
    res.status(400).json({ error: '参数错误' });
    return;
  }
  const doc = getDoc(novelId, kind, id);
  if (!doc) {
    res.status(404).json({ error: '文档不存在' });
    return;
  }
  res.json(doc);
});

// 新建文档（编辑器/资源管理器共用）
docsRouter.post('/', (req, res) => {
  const novelId = Number(req.body?.novelId);
  const kind = parseKind(String(req.body?.kind ?? ''));
  const title = req.body?.title !== undefined ? String(req.body.title) : undefined;
  if (!novelId || !kind) {
    res.status(400).json({ error: 'novelId 与 kind 必填' });
    return;
  }
  const doc = createDoc(novelId, kind, title);
  void snapshotNow(novelId);
  res.status(201).json(doc);
});

// 保存正文（body）与结构化字段
docsRouter.put('/:kind/:id', (req, res) => {
  const novelId = Number(req.body?.novelId);
  const kind = parseKind(req.params.kind);
  const id = Number(req.params.id);
  if (!novelId || !kind || !id) {
    res.status(400).json({ error: '参数错误' });
    return;
  }
  const doc = getDoc(novelId, kind, id);
  if (!doc) {
    res.status(404).json({ error: '文档不存在' });
    return;
  }
  const fields =
    req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : undefined;
  const updated = writeDoc(doc, {
    body: req.body?.body !== undefined ? String(req.body.body) : undefined,
    fields,
    // 人物卡/世界观改名时同步重命名文件
    title: req.body?.title !== undefined ? String(req.body.title) : undefined,
  });
  scheduleSnapshot(novelId);
  res.json(updated);
});

// 删除文档
docsRouter.delete('/:kind/:id', async (req, res) => {
  const novelId = Number(req.query.novelId);
  const kind = parseKind(req.params.kind);
  const id = Number(req.params.id);
  if (!novelId || !kind || !id) {
    res.status(400).json({ error: '参数错误' });
    return;
  }
  await deleteDoc(novelId, kind, id);
  void snapshotNow(novelId);
  res.status(204).end();
});
