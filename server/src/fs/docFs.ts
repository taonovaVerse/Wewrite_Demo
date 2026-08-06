import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import type { DocKind, DocRow } from '../types.js';
import { sanitizeName, resolveNovelPath, atomicWrite, cleanupEmptyDirs } from './paths.js';
import { parseChapterFile, serializeChapterFile } from './frontmatter.js';
import { novelRoot, nextDocId } from './novelFs.js';
import { listNovels } from './registry.js';

/**
 * 世界文档文件系统：5 类管理数据（人物卡/世界观/伏笔/文风/素材库）落盘为
 * <novel>/.docs/<类>/*.md，front-matter 存结构化字段、正文存自由笔记（素材库正文=content）。
 * .docs 是隐藏目录，章节 walkDir 的 `!name.startsWith('.')` 过滤天然跳过，互不干扰。
 * 复用章节的 parse/serialize（保留作者手写字段）与 atomicWrite（安全写盘）。
 */

// 每类文档的 front-matter 字段定义（key = front-matter 字段名，也是旧表列名）
interface DocField {
  key: string;
  kind: 'string' | 'int|null';
  default: string | number | null;
}

interface DocKindDef {
  kind: DocKind;
  dir: string; // .docs 下子目录名
  label: string; // 中文兜底名（默认文件名）
  fields: DocField[];
}

const DOC_KINDS: Record<DocKind, DocKindDef> = {
  characters: {
    kind: 'characters',
    dir: '人物卡',
    label: '人物卡',
    fields: [
      { key: 'name', kind: 'string', default: '' },
      { key: 'profile', kind: 'string', default: '' },
      { key: 'speaking_style', kind: 'string', default: '' },
      { key: 'status', kind: 'string', default: '' },
    ],
  },
  world: {
    kind: 'world',
    dir: '世界观',
    label: '世界观',
    fields: [
      { key: 'key', kind: 'string', default: '' },
      { key: 'value', kind: 'string', default: '' },
    ],
  },
  foreshadow: {
    kind: 'foreshadow',
    dir: '伏笔',
    label: '伏笔',
    fields: [
      { key: 'note', kind: 'string', default: '' },
      { key: 'planted_chapter', kind: 'int|null', default: null },
      { key: 'resolved_chapter', kind: 'int|null', default: null },
    ],
  },
  style: {
    kind: 'style',
    dir: '文风',
    label: '文风',
    fields: [
      { key: 'voice', kind: 'string', default: '' },
      { key: 'rhythm_notes', kind: 'string', default: '' },
      { key: 'taboo_words', kind: 'string', default: '' },
    ],
  },
  bank: {
    kind: 'bank',
    dir: '素材库',
    label: '素材库',
    fields: [
      { key: 'scene_type', kind: 'string', default: '' },
      { key: 'sensory_channel', kind: 'string', default: '' },
      { key: 'tags', kind: 'string', default: '' },
    ],
  },
};

// 文件名锚定方式：true = 文件名即 id（伏笔/文风/素材库，免改名）；false = 按名称命名（人物卡/世界观，改名联动文件）
const ID_NAMED: Record<DocKind, boolean> = {
  characters: false,
  world: false,
  foreshadow: true,
  style: true,
  bank: true,
};

const TABLE_BY_KIND: Record<DocKind, string> = {
  characters: 'characters',
  world: 'world_settings',
  foreshadow: 'foreshadowing',
  style: 'style_profiles',
  bank: 'detail_bank',
};

// ---- 基础读写 ----

function docsRoot(novelId: number): string | null {
  const root = novelRoot(novelId);
  return root ? path.join(root, '.docs') : null;
}

function kindDir(novelId: number, kind: DocKind): string | null {
  const root = docsRoot(novelId);
  return root ? path.join(root, DOC_KINDS[kind].dir) : null;
}

function absToRel(novelId: number, absPath: string): string {
  const root = novelRoot(novelId) ?? '';
  return path.relative(root, absPath).split(path.sep).join('/');
}

function asId(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

function coerceField(f: DocField, v: unknown): string | number | null {
  if (v === undefined || v === null) return f.default;
  if (f.kind === 'int|null') {
    const n = Number(v);
    return Number.isInteger(n) ? n : f.default;
  }
  return String(v);
}

function preview(text: string): string {
  const line = String(text ?? '').split('\n').find((l) => l.trim()) ?? '';
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

/** 展示名：优先结构化字段/正文摘要，兜底文件名 */
function docTitle(kind: DocKind, fields: DocRow['fields'], body: string, fileName: string): string {
  switch (kind) {
    case 'characters':
      return String(fields.name || fileName || '人物');
    case 'world':
      return String(fields.key || fileName || '设定');
    case 'foreshadow':
      return preview(String(fields.note ?? '')) || `伏笔 ${fileName}`;
    case 'style':
      return '文风档案';
    case 'bank':
      return preview(body) || `素材 ${fileName}`;
  }
}

/** 解析单个文档文件 → DocRow（id 缺失时返回 -1，由调用方 ensure 后写回） */
function readDocFile(novelId: number, kind: DocKind, absPath: string): DocRow {
  const def = DOC_KINDS[kind];
  const raw = fs.readFileSync(absPath, 'utf8');
  const { data, body } = parseChapterFile(raw);
  let id = asId(data.id);
  if (id === -1 && ID_NAMED[kind]) {
    const fromName = Number(path.basename(absPath, '.md'));
    if (Number.isInteger(fromName) && fromName > 0) id = fromName;
  }
  const fields: DocRow['fields'] = {};
  for (const f of def.fields) fields[f.key] = coerceField(f, data[f.key]);
  const fileName = path.basename(absPath, '.md');
  return {
    kind,
    id,
    novel_id: novelId,
    title: docTitle(kind, fields, body, fileName),
    body,
    fields,
    path: absToRel(novelId, absPath),
  };
}

/** 已占用的同 kind id 集合（用于发号去重，体量小直接扫文件） */
function usedDocIds(novelId: number, kind: DocKind): Set<number> {
  const used = new Set<number>();
  const dir = kindDir(novelId, kind);
  if (!dir || !fs.existsSync(dir)) return used;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const id = asId(parseChapterFile(fs.readFileSync(path.join(dir, e.name), 'utf8')).data.id);
    if (id > 0) used.add(id);
  }
  return used;
}

/** 发一个同 kind 不重复的文档 id（旧表迁移来的 id 可能与计数器冲突，需跳过） */
function nextFreeDocId(novelId: number, kind: DocKind): number {
  const used = usedDocIds(novelId, kind);
  let id = nextDocId(novelId);
  while (used.has(id)) id = nextDocId(novelId);
  return id;
}

/** 文件缺 id（或与同 kind 冲突）时补发并幂等写回 */
function ensureDocId(novelId: number, row: DocRow, data: Record<string, unknown>, absPath: string): void {
  if (row.id !== -1) return;
  row.id = nextFreeDocId(novelId, row.kind);
  atomicWrite(absPath, serializeChapterFile({ ...data, id: row.id }, row.body));
}

// ---- 查询 ----

/** 列出小说全部文档（各 kind 内按 id 排序） */
export function listNovelDocs(novelId: number): DocRow[] {
  const root = docsRoot(novelId);
  if (!root || !fs.existsSync(root)) return [];
  const out: DocRow[] = [];
  for (const kind of Object.keys(DOC_KINDS) as DocKind[]) {
    const dir = path.join(root, DOC_KINDS[kind].dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const docs: DocRow[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      try {
        const abs = path.join(dir, e.name);
        const row = readDocFile(novelId, kind, abs);
        if (row.id === -1) {
          const { data } = parseChapterFile(fs.readFileSync(abs, 'utf8'));
          ensureDocId(novelId, row, data, abs);
        }
        docs.push(row);
      } catch {
        /* 坏文件跳过 */
      }
    }
    docs.sort((a, b) => a.id - b.id);
    out.push(...docs);
  }
  return out;
}

/** 按 kind+id 取文档；不存在返回 undefined */
export function getDoc(novelId: number, kind: DocKind, id: number): DocRow | undefined {
  const dir = kindDir(novelId, kind);
  if (!dir || !fs.existsSync(dir)) return undefined;
  if (ID_NAMED[kind]) {
    const abs = path.join(dir, `${id}.md`);
    if (fs.existsSync(abs)) return readDocFile(novelId, kind, abs);
  }
  // 兜底：全目录按 id 匹配（人物卡/世界观按名称命名，或手写文件用了不规范文件名）
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try {
      const row = readDocFile(novelId, kind, path.join(dir, e.name));
      if (row.id === id) return row;
    } catch {
      /* 坏文件跳过 */
    }
  }
  return undefined;
}

/** 取文风单例；不存在返回 undefined（由 createDoc('style') 创建） */
export function getStyleDoc(novelId: number): DocRow | undefined {
  const dir = kindDir(novelId, 'style');
  if (!dir || !fs.existsSync(dir)) return undefined;
  const file = fs
    .readdirSync(dir, { withFileTypes: true })
    .find((e) => e.isFile() && e.name.endsWith('.md'));
  if (!file) return undefined;
  return readDocFile(novelId, 'style', path.join(dir, file.name));
}

/** 仅取某 kind 的文档列表 */
export function listKindDocs(novelId: number, kind: DocKind): DocRow[] {
  return listNovelDocs(novelId).filter((d) => d.kind === kind);
}

// ---- 写 ----

/** 新建文档：发 id、写默认文件。style 为单例（已存在直接返回现有）；人物卡/世界观用 title 作 name/key */
export function createDoc(novelId: number, kind: DocKind, title?: string): DocRow {
  const def = DOC_KINDS[kind];
  if (kind === 'style') {
    const existing = getStyleDoc(novelId);
    if (existing) return existing;
  }
  const dir = kindDir(novelId, kind);
  if (!dir) throw new Error('小说目录不存在');
  const id = nextFreeDocId(novelId, kind);
  const data: Record<string, unknown> = { id };
  for (const f of def.fields) {
    if (kind === 'characters' && f.key === 'name' && title) data[f.key] = title;
    else if (kind === 'world' && f.key === 'key' && title) data[f.key] = title;
  }
  let name: string;
  if (ID_NAMED[kind]) {
    name = `${id}.md`;
  } else {
    const base = sanitizeName(title || def.label);
    name = `${base}.md`;
    let k = 2;
    while (fs.existsSync(path.join(dir, name))) name = `${base} ${k}.md`, k++;
  }
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  atomicWrite(abs, serializeChapterFile(data, ''));
  return readDocFile(novelId, kind, abs);
}

/** 写文档：合并 front-matter + 正文。title 变化时同步重命名文件（仅按名称命名的类型） */
export function writeDoc(
  doc: DocRow,
  patch: { body?: string; fields?: Record<string, string | number | null>; title?: string },
): DocRow {
  const root = novelRoot(doc.novel_id);
  if (!root) throw new Error('小说目录不存在');
  let abs = resolveNovelPath(root, doc.path);
  if (!fs.existsSync(abs)) throw new Error('文档不存在');
  const parsed = parseChapterFile(fs.readFileSync(abs, 'utf8'));
  const data: Record<string, unknown> = { ...parsed.data, id: doc.id };
  if (patch.fields) {
    for (const [k, v] of Object.entries(patch.fields)) {
      if (v === undefined || v === null || v === '') delete data[k];
      else data[k] = v;
    }
  }
  const body = patch.body !== undefined ? patch.body : parsed.body;

  if (patch.title !== undefined && !ID_NAMED[doc.kind]) {
    const oldName = path.basename(abs, '.md');
    const safe = sanitizeName(patch.title || DOC_KINDS[doc.kind].label);
    if (safe !== oldName) {
      const dir = path.dirname(abs);
      let name = `${safe}.md`;
      let k = 2;
      while (fs.existsSync(path.join(dir, name))) name = `${safe} ${k}.md`, k++;
      const target = path.join(dir, name);
      fs.renameSync(abs, target);
      abs = target;
    }
  }
  atomicWrite(abs, serializeChapterFile(data, body));
  return readDocFile(doc.novel_id, doc.kind, abs);
}

/** 删除文档文件并向上清理空目录。注意：必须用 fs.promises.rm（异步），与章节删除同因（Windows rename 句柄未排空） */
export async function deleteDoc(novelId: number, kind: DocKind, id: number): Promise<void> {
  const doc = getDoc(novelId, kind, id);
  if (!doc) throw new Error('文档不存在');
  const root = novelRoot(novelId);
  if (!root) return;
  const abs = resolveNovelPath(root, doc.path);
  await fs.promises.rm(abs, { force: true });
  cleanupEmptyDirs(root, path.dirname(doc.path));
}

/** 按 kind+id 反查所属小说与文档（文档 id 全局唯一；老管理路由 DELETE/PUT 只带 id） */
export function findDoc(kind: DocKind, id: number): { novelId: number; doc: DocRow } | undefined {
  for (const n of listNovels()) {
    const doc = getDoc(n.id, kind, id);
    if (doc) return { novelId: n.id, doc };
  }
  return undefined;
}

/** 素材库写文件后同步 detail_bank mirror 行（触发器自动维护 FTS） */
export function upsertBankMirror(doc: DocRow): void {
  db.prepare(
    `INSERT INTO detail_bank (id, novel_id, scene_type, sensory_channel, content, tags)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       scene_type = excluded.scene_type,
       sensory_channel = excluded.sensory_channel,
       content = excluded.content,
       tags = excluded.tags`
  ).run(
    doc.id,
    doc.novel_id,
    String(doc.fields.scene_type ?? ''),
    String(doc.fields.sensory_channel ?? ''),
    doc.body,
    String(doc.fields.tags ?? ''),
  );
}

/** 素材删除后同步移除 detail_bank mirror 行 */
export function removeBankMirror(id: number): void {
  db.prepare('DELETE FROM detail_bank WHERE id = ?').run(id);
}

// ---- 迁移：5 张管理表 → .docs 文件（仅当未迁移时执行，绝不覆盖作者手写文件）----

export function migrateAllDocs(): void {
  for (const n of listNovels()) migrateNovelDocs(n.id);
}

/** 启动时把每部小说的素材库文件重灌成 detail_bank mirror（外部小说同样覆盖，FTS 由触发器维护） */
export function syncAllBankMirrors(): void {
  for (const n of listNovels()) syncBankMirror(n.id);
}

function migrateNovelDocs(novelId: number): void {
  const root = docsRoot(novelId);
  if (!root) return;
  // 人物卡目录存在即视为已迁移（迁移是整批的，任一 kind 已在盘上就不再动）
  if (fs.existsSync(path.join(root, DOC_KINDS.characters.dir))) return;
  fs.mkdirSync(root, { recursive: true });
  for (const kind of Object.keys(DOC_KINDS) as DocKind[]) migrateKindTable(novelId, root, kind);
  syncBankMirror(novelId); // 迁移后把素材库文件重灌成 detail_bank mirror
}

function migrateKindTable(novelId: number, root: string, kind: DocKind): void {
  const def = DOC_KINDS[kind];
  const dir = path.join(root, def.dir);
  fs.mkdirSync(dir, { recursive: true });
  const rows = db
    .prepare(`SELECT * FROM ${TABLE_BY_KIND[kind]} WHERE novel_id = ? ORDER BY id`)
    .all(novelId) as Record<string, unknown>[];
  for (const r of rows) {
    const data: Record<string, unknown> = { id: r.id };
    for (const f of def.fields) {
      if (r[f.key] !== undefined && r[f.key] !== null && r[f.key] !== '') data[f.key] = r[f.key];
    }
    const body = kind === 'bank' ? String(r.content ?? '') : '';
    let name: string;
    if (ID_NAMED[kind]) {
      name = `${r.id}.md`;
    } else {
      const base = sanitizeName(String(r.name ?? r.key ?? def.label));
      name = `${base}.md`;
      let k = 2;
      while (fs.existsSync(path.join(dir, name))) name = `${base} ${k}.md`, k++;
    }
    atomicWrite(path.join(dir, name), serializeChapterFile(data, body));
  }
}

/** 素材库以 .docs/素材库/*.md 为唯一事实源：把 detail_bank 表重灌成 mirror（FTS 由触发器维护） */
export function syncBankMirror(novelId: number): void {
  const docs = listKindDocs(novelId, 'bank');
  db.prepare('DELETE FROM detail_bank WHERE novel_id = ?').run(novelId);
  const insert = db.prepare(
    `INSERT INTO detail_bank (id, novel_id, scene_type, sensory_channel, content, tags)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const txn = db.transaction((rows: DocRow[]) => {
    for (const d of rows) {
      insert.run(
        d.id,
        novelId,
        String(d.fields.scene_type ?? ''),
        String(d.fields.sensory_channel ?? ''),
        d.body,
        String(d.fields.tags ?? ''),
      );
    }
  });
  txn(docs);
}
