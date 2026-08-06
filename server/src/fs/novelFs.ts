import fs from 'node:fs';
import path from 'node:path';
import type { ChapterRow } from '../types.js';
import {
  sanitizeName,
  safeRelPath,
  resolveNovelPath,
  atomicWrite,
  cleanupEmptyDirs,
} from './paths.js';
import { extractMeta, parseChapterFile, serializeChapterFile, type ChapterMeta } from './frontmatter.js';
import { NOVELS_ROOT, novelRoot, nextId, listNovels } from './registry.js';

// 保持既有导入兼容：docFs/路由仍从 novelFs 取 NOVELS_ROOT / novelRoot
export { NOVELS_ROOT, novelRoot };

/** 资源管理器文件树节点（chapterId 仅在 file 节点上有值） */
export interface FileNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  folder: string;
  chapterId?: number;
  children?: FileNode[];
}

// 章节 id → 文件位置 索引。任何写操作后标记失效，读时重建（作者在 VSCode 里增删文件也会在下次遍历时被吸收）
let idIndexDirty = true;
const idIndex = new Map<number, { novelId: number; root: string; rel: string }>();

function markDirty(): void {
  idIndexDirty = true;
}

/** 世界文档发号：与章节/小说共用全局计数器（全库递增、跨类型不重复）；同 kind 去重由调用方兜底 */
export function nextDocId(novelId: number): number {
  return nextId();
}

function statTime(abs: string): string {
  try {
    return fs.statSync(abs).mtime.toISOString();
  } catch {
    return '';
  }
}

/** 读单个章节文件：解析 front-matter + 正文。id 可能为 -1（缺 id，由 ensureChapterId 补） */
function readChapterFile(
  novelId: number,
  absPath: string,
): { row: ChapterRow; meta: ChapterMeta; data: Record<string, unknown> } {
  const raw = fs.readFileSync(absPath, 'utf8');
  const { data, body } = parseChapterFile(raw);
  const meta = extractMeta(data);
  const fileName = path.basename(absPath);
  const relPath = absToRel(novelId, absPath);
  const title = meta.title ?? fileName.replace(/\.md$/, '');
  return {
    row: {
      id: meta.id ?? -1,
      novel_id: novelId,
      order_idx: meta.order ?? 0,
      title,
      content: body,
      blueprint: meta.blueprint ?? '',
      location: meta.location ?? '',
      time_frame: meta.time_frame ?? '',
      emotion: meta.emotion ?? '',
      theme: meta.theme ?? '',
      scene_characters: meta.scene_characters ?? '',
      status: meta.status ?? 'drafting',
      folder: relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '',
      path: relPath,
      created_at: '',
      updated_at: statTime(absPath),
    },
    meta,
    data,
  };
}

function absToRel(novelId: number, absPath: string): string {
  const root = novelRoot(novelId) ?? '';
  return path.relative(root, absPath).split(path.sep).join('/');
}

/** 文件缺 id（或 id 冲突）时补发一个并幂等写回，保证作者手工新建的 .md 也有稳定 id */
function ensureChapterId(
  row: ChapterRow,
  meta: ChapterMeta,
  data: Record<string, unknown>,
  root: string,
): void {
  if (row.id === meta.id && row.id !== -1) return;
  row.id = nextId();
  const merged = { ...data, id: row.id, order: meta.order ?? row.order_idx };
  atomicWrite(resolveNovelPath(root, row.path), serializeChapterFile(merged, row.content));
}

/** 深度优先遍历小说目录：返回树 + 平铺章节（文件夹在前、文件按 front-matter order 排序） */
function walkDir(
  novelId: number,
  root: string,
  relDir: string,
): { nodes: FileNode[]; chapters: ChapterRow[] } {
  const absDir = relDir ? path.join(root, relDir) : root;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return { nodes: [], chapters: [] };
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const nodes: FileNode[] = [];
  const chapters: ChapterRow[] = [];

  for (const d of dirs) {
    const childRel = relDir ? `${relDir}/${d.name}` : d.name;
    const sub = walkDir(novelId, root, childRel);
    nodes.push({
      name: d.name,
      type: 'folder',
      path: childRel,
      folder: relDir,
      children: sub.nodes,
    });
    chapters.push(...sub.chapters);
  }

  const parsed: { row: ChapterRow; meta: ChapterMeta; data: Record<string, unknown> }[] = [];
  for (const f of files) parsed.push(readChapterFile(novelId, path.join(absDir, f.name)));
  parsed.sort(
    (a, b) =>
      (a.meta.order ?? Infinity) - (b.meta.order ?? Infinity) ||
      a.row.title.localeCompare(b.row.title),
  );

  const used = new Set<number>();
  for (const { row, meta, data } of parsed) {
    if (meta.id !== undefined && used.has(meta.id)) row.id = -1; // 重复 id 强制换新
    if (row.id === -1) ensureChapterId(row, meta, data, root);
    used.add(row.id);
    idIndex.set(row.id, { novelId, root, rel: row.path });
    nodes.push({
      name: path.basename(row.path),
      type: 'file',
      path: row.path,
      folder: row.folder,
      chapterId: row.id,
    });
    chapters.push(row);
  }

  return { nodes, chapters };
}

/** 列出小说文件树 + 平铺章节（深度优先顺序） */
export function listNovelTree(novelId: number): { tree: FileNode[]; chapters: ChapterRow[] } {
  const root = novelRoot(novelId);
  if (!root || !fs.existsSync(root)) return { tree: [], chapters: [] };
  const { nodes, chapters } = walkDir(novelId, root, '');
  return { tree: nodes, chapters };
}

/** 深度优先顺序的章节列表（供 SLS「前文」检索） */
export function listChaptersInOrder(novelId: number): ChapterRow[] {
  return listNovelTree(novelId).chapters;
}

function rebuildIdIndex(): void {
  idIndex.clear();
  for (const n of listNovels()) {
    if (!fs.existsSync(n.root)) continue;
    walkDir(n.id, n.root, '');
  }
  idIndexDirty = false;
}

/** 按章节 id 取章节；不存在返回 undefined */
export function getChapterById(id: number): ChapterRow | undefined {
  if (idIndexDirty) rebuildIdIndex();
  const hit = idIndex.get(id);
  if (!hit) return undefined;
  const abs = resolveNovelPath(hit.root, hit.rel);
  if (!fs.existsSync(abs)) return undefined;
  return readChapterFile(hit.novelId, abs).row;
}

function setOrDelete(data: Record<string, unknown>, key: string, value: string): void {
  if (value) data[key] = value;
  else delete data[key];
}

/** 把章节写回磁盘：保留作者手写的前置字段，只合并已知字段 */
export function writeChapter(ch: ChapterRow): void {
  const root = novelRoot(ch.novel_id);
  if (!root) throw new Error('小说目录不存在');
  const rel =
    ch.path || (ch.folder ? `${ch.folder}/${sanitizeName(ch.title)}.md` : `${sanitizeName(ch.title)}.md`);
  const abs = resolveNovelPath(root, rel);

  let data: Record<string, unknown> = {};
  if (fs.existsSync(abs)) data = parseChapterFile(fs.readFileSync(abs, 'utf8')).data;
  data.id = ch.id;
  data.order = ch.order_idx;
  setOrDelete(data, 'title', ch.title);
  setOrDelete(data, 'location', ch.location);
  setOrDelete(data, 'time_frame', ch.time_frame);
  setOrDelete(data, 'emotion', ch.emotion);
  setOrDelete(data, 'theme', ch.theme);
  setOrDelete(data, 'scene_characters', ch.scene_characters);
  setOrDelete(data, 'blueprint', ch.blueprint);
  setOrDelete(data, 'status', ch.status);

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  atomicWrite(abs, serializeChapterFile(data, ch.content));
  idIndex.set(ch.id, { novelId: ch.novel_id, root, rel });
  markDirty();
}

/** 标题变化时同步重命名 .md 文件名（front-matter 里的 id/order 不变）；无变化则不动 */
export function renameFileToTitle(ch: ChapterRow): void {
  const root = novelRoot(ch.novel_id);
  if (!root) return;
  const safe = sanitizeName(ch.title || '未命名章节');
  const curBase = path.basename(ch.path, '.md');
  if (safe === curBase) return;
  const srcAbs = resolveNovelPath(root, ch.path);
  if (!fs.existsSync(srcAbs)) return;
  let name = `${safe}.md`;
  let k = 2;
  while (fs.existsSync(path.join(root, ch.folder, name))) {
    name = `${safe} ${k}.md`;
    k++;
  }
  const targetAbs = path.join(root, ch.folder, name);
  fs.renameSync(srcAbs, targetAbs);
  ch.path = ch.folder ? `${ch.folder}/${name}` : name;
  markDirty();
}

function nextOrderInDir(root: string, relDir: string): number {
  const absDir = relDir ? path.join(root, relDir) : root;
  let max = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return 1;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try {
      const { data } = parseChapterFile(fs.readFileSync(path.join(absDir, e.name), 'utf8'));
      const order = Number(data.order);
      if (Number.isInteger(order) && order > max) max = order;
    } catch {
      /* 坏文件跳过 */
    }
  }
  return max + 1;
}

/** 新建章节：写 .md 到指定文件夹（folder 相对小说根，'' 为根目录） */
export function createChapterFile(novelId: number, title: string, folder: string): ChapterRow {
  const root = novelRoot(novelId);
  if (!root) throw new Error('小说目录不存在');
  const relDir = safeRelPath(folder);
  const id = nextId();
  const safe = sanitizeName(title || '未命名章节');
  const order = nextOrderInDir(root, relDir);

  let name = `${safe}.md`;
  let k = 2;
  while (fs.existsSync(path.join(root, relDir, name))) {
    name = `${safe} ${k}.md`;
    k++;
  }
  const rel = relDir ? `${relDir}/${name}` : name;
  const chapter: ChapterRow = {
    id,
    novel_id: novelId,
    order_idx: order,
    title: String(title ?? '').trim() || '未命名章节',
    content: '',
    blueprint: '',
    location: '',
    time_frame: '',
    emotion: '',
    theme: '',
    scene_characters: '',
    status: 'drafting',
    folder: relDir,
    path: rel,
    created_at: '',
    updated_at: '',
  };
  writeChapter(chapter);
  return chapter;
}

interface DirEntry {
  name: string;
  abs: string;
  id: number;
  order: number;
}

function listDirEntries(absDir: string): DirEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DirEntry[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const abs = path.join(absDir, e.name);
    let id = -1;
    let order = Infinity;
    try {
      const { data } = parseChapterFile(fs.readFileSync(abs, 'utf8'));
      const o = Number(data.order);
      if (Number.isInteger(o) && o > 0) order = o;
      const i = Number(data.id);
      if (Number.isInteger(i) && i > 0) id = i;
    } catch {
      /* 坏文件跳过 */
    }
    out.push({ name: e.name, abs, id, order });
  }
  return out;
}

/** 重排某文件夹内章节 order 为 1..n；opts 可指定把 moveId 插入到 beforeId 之前（或末尾） */
function renumberDir(
  root: string,
  relDir: string,
  opts?: { moveId?: number; beforeId?: number },
): void {
  const absDir = relDir ? path.join(root, relDir) : root;
  const list = listDirEntries(absDir).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  if (opts?.moveId !== undefined) {
    const idx = list.findIndex((e) => e.id === opts.moveId);
    if (idx >= 0) {
      const [moved] = list.splice(idx, 1);
      if (opts.beforeId !== undefined) {
        const at = list.findIndex((e) => e.id === opts.beforeId);
        list.splice(at === -1 ? list.length : at, 0, moved);
      } else {
        list.push(moved);
      }
    }
  }

  list.forEach((e, i) => {
    const target = i + 1;
    if (e.order === target) return;
    try {
      const { data, body } = parseChapterFile(fs.readFileSync(e.abs, 'utf8'));
      data.order = target;
      atomicWrite(e.abs, serializeChapterFile(data, body));
    } catch {
      /* 写坏文件跳过 */
    }
  });
}

/** 移动章节到目标文件夹（可指定插入位 beforeId），并重排源/目标文件夹的 order */
export function moveChapter(
  novelId: number,
  chapterId: number,
  targetFolder: string,
  beforeId?: number,
): ChapterRow {
  const root = novelRoot(novelId);
  if (!root) throw new Error('小说目录不存在');
  const cur = getChapterById(chapterId);
  if (!cur) throw new Error('章节不存在');
  const targetRel = safeRelPath(targetFolder);
  const fromRel = cur.folder;

  if (fromRel !== targetRel) {
    const srcAbs = resolveNovelPath(root, cur.path);
    const safe = sanitizeName(cur.title || '未命名章节');
    let name = `${safe}.md`;
    let k = 2;
    while (fs.existsSync(path.join(root, targetRel, name))) {
      name = `${safe} ${k}.md`;
      k++;
    }
    const targetAbs = path.join(root, targetRel, name);
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.renameSync(srcAbs, targetAbs);
    cur.folder = targetRel;
    cur.path = targetRel ? `${targetRel}/${name}` : name;
  }

  renumberDir(root, targetRel, { moveId: chapterId, beforeId });
  if (fromRel !== targetRel) renumberDir(root, fromRel);
  markDirty();
  return getChapterById(chapterId) ?? cur;
}

/** 删除章节文件，重排剩余顺序并清理空目录 */
// 注意：删除必须用 fs.promises.rm（异步）——紧跟大量 fs.renameSync 之后立即用 rmSync 会在 Windows 上静默失败（rename 句柄未排空）
export async function deleteChapter(novelId: number, id: number): Promise<void> {
  const root = novelRoot(novelId);
  if (!root) throw new Error('小说目录不存在');
  const ch = getChapterById(id);
  if (!ch) throw new Error('章节不存在');
  const abs = resolveNovelPath(root, ch.path);
  await fs.promises.rm(abs, { force: true });
  renumberDir(root, ch.folder);
  cleanupEmptyDirs(root, ch.folder);
  markDirty();
}

/** 新建文件夹（可带父路径），返回其相对路径 */
export function createFolder(novelId: number, name: string, parent: string): string {
  const root = novelRoot(novelId);
  if (!root) throw new Error('小说目录不存在');
  const rel = safeRelPath(parent ? `${parent}/${sanitizeName(name)}` : sanitizeName(name));
  fs.mkdirSync(path.join(root, rel), { recursive: true });
  return rel;
}

/** 重命名文件夹（可带父路径）；章节的 folder/path 在下次读盘时按新路径重算 */
export function renameFolder(novelId: number, folder: string, newName: string): string {
  const root = novelRoot(novelId);
  if (!root) throw new Error('小说目录不存在');
  const rel = safeRelPath(folder);
  if (!rel) throw new Error('不能重命名小说根目录');
  const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const safe = sanitizeName(newName || '未命名文件夹');
  const newRel = parent ? `${parent}/${safe}` : safe;
  if (newRel === rel) return rel;
  const srcAbs = resolveNovelPath(root, rel);
  const dstAbs = resolveNovelPath(root, newRel);
  if (!fs.existsSync(srcAbs)) throw new Error('文件夹不存在');
  if (fs.existsSync(dstAbs)) throw new Error('目标文件夹已存在');
  fs.renameSync(srcAbs, dstAbs);
  markDirty();
  return newRel;
}

/** 删除文件夹（递归）。根目录不可删 */
export async function deleteFolder(novelId: number, folder: string): Promise<void> {
  const root = novelRoot(novelId);
  if (!root) throw new Error('小说目录不存在');
  const rel = safeRelPath(folder);
  if (!rel) throw new Error('不能删除小说根目录');
  const abs = resolveNovelPath(root, rel);
  if (abs === path.resolve(root)) throw new Error('不能删除小说根目录');
  await fs.promises.rm(abs, { recursive: true, force: true });
  markDirty();
}

// ---- 迁移：老库 chapters 表 → 磁盘 .md（已由 registry 迁移接管目录与 .wewrite）----

/** 启动时兜底：保证每个已注册小说的目录存在（Phase 1 章节导出已完成，这里不再动文件） */
export function migrateAllNovels(): void {
  for (const n of listNovels()) {
    fs.mkdirSync(n.root, { recursive: true });
  }
}
