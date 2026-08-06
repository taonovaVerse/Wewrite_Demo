import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from '../db.js';
import { sanitizeName, atomicWrite } from './paths.js';

// ---- 磁盘 novel 注册表：唯一权威。内部小说靠扫 NOVELS_ROOT/*/，外部小说记在 .registry.json ----

export const NOVELS_ROOT = path.join(DATA_DIR, 'novels');
const REGISTRY_FILE = path.join(NOVELS_ROOT, '.registry.json');

/** 一部小说的磁盘元数据（folder：内部=目录名，外部=绝对路径；root 恒为绝对路径） */
export interface NovelMeta {
  id: number;
  title: string;
  folder: string;
  created_at: string;
  updated_at: string;
  external: boolean;
  root: string;
}

interface ExternalEntry {
  id: number;
  path: string;
}

// ---- 注册表缓存：懒加载 + dirty 标记（任何写操作后失效，读时重建，保证请求内 O(1)）----
let registryDirty = true;
const byId = new Map<number, NovelMeta>();

export function markRegistryDirty(): void {
  registryDirty = true;
}

function nowStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function readNovelMeta(root: string, external: boolean, folder: string): NovelMeta | undefined {
  const file = path.join(root, '.wewrite', 'novel.json');
  if (!fs.existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      id?: unknown;
      title?: unknown;
      created_at?: unknown;
      updated_at?: unknown;
    };
    const id = Number(raw.id);
    if (!Number.isInteger(id)) return undefined;
    return {
      id,
      title: String(raw.title ?? ''),
      folder,
      created_at: String(raw.created_at ?? ''),
      updated_at: String(raw.updated_at ?? ''),
      external,
      root,
    };
  } catch (e) {
    console.warn(`[registry] 小说元数据损坏，已跳过：${file}`, e);
    return undefined;
  }
}

function readExternalList(): ExternalEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')) as {
      external?: unknown;
    };
    if (!Array.isArray(raw.external)) return [];
    return raw.external
      .filter(
        (x): x is ExternalEntry =>
          typeof (x as { id?: unknown }).id === 'number' &&
          typeof (x as { path?: unknown }).path === 'string',
      )
      .map((x) => ({ id: Number(x.id), path: x.path }));
  } catch (e) {
    // 损坏不回写（留人工修复），视为无外部小说
    console.warn(`[registry] 读取外部小说索引失败：${REGISTRY_FILE}`, e);
    return [];
  }
}

function writeExternalList(entries: ExternalEntry[]): void {
  atomicWrite(REGISTRY_FILE, JSON.stringify({ version: 1, external: entries }, null, 2));
}

function rebuild(): void {
  byId.clear();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(NOVELS_ROOT, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const meta = readNovelMeta(path.join(NOVELS_ROOT, e.name), false, e.name);
    if (meta) byId.set(meta.id, meta);
  }
  for (const ext of readExternalList()) {
    const meta = readNovelMeta(ext.path, true, ext.path);
    if (meta) byId.set(meta.id, meta);
  }
  registryDirty = false;
}

function ensure(): void {
  if (registryDirty) rebuild();
}

// ---- 全局发号器（novel/章节/世界文档共用，insert-then-delete 推高 AUTOINCREMENT）----
export function nextId(): number {
  const r = db.prepare('INSERT INTO ids (id) VALUES (NULL)').run();
  db.prepare('DELETE FROM ids WHERE id = ?').run(r.lastInsertRowid);
  return Number(r.lastInsertRowid);
}

/** 为小说分配唯一目录名：清洗标题 + 目录存在则加数值后缀 */
export function allocateFolderName(title: string): string {
  const base = sanitizeName(title || '未命名小说');
  let folder = base;
  let k = 2;
  while (fs.existsSync(path.join(NOVELS_ROOT, folder))) folder = `${base} ${k++}`;
  return folder;
}

function writeNovelMeta(meta: NovelMeta): void {
  const dir = path.join(meta.root, '.wewrite');
  fs.mkdirSync(dir, { recursive: true });
  atomicWrite(
    path.join(dir, 'novel.json'),
    JSON.stringify(
      {
        id: meta.id,
        title: meta.title,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
      },
      null,
      2,
    ),
  );
}

export function listNovels(): NovelMeta[] {
  ensure();
  return [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function novelById(id: number): NovelMeta | undefined {
  ensure();
  return byId.get(id);
}

export function novelRoot(novelId: number): string | null {
  return novelById(novelId)?.root ?? null;
}

/** 章节/文档写操作后刷新 updated_at（驱动列表排序），重写 novel.json */
export function touchNovel(id: number): void {
  const meta = novelById(id);
  if (!meta) return;
  writeNovelMeta({ ...meta, updated_at: nowStr() });
  markRegistryDirty();
}

/** 新建内部小说：立即建目录 + 写 .wewrite/novel.json（否则扫描发现不了） */
export function createInternalNovel(title: string): NovelMeta {
  const folder = allocateFolderName(title);
  const now = nowStr();
  const meta: NovelMeta = {
    id: nextId(),
    title,
    folder,
    created_at: now,
    updated_at: now,
    external: false,
    root: path.join(NOVELS_ROOT, folder),
  };
  fs.mkdirSync(meta.root, { recursive: true });
  writeNovelMeta(meta);
  markRegistryDirty();
  return meta;
}

/** 打开外部文件夹为小说。幂等：同路径或已有 novel.json 则复用 id/标题 */
export function openExternalNovel(rawPath: string): { meta: NovelMeta; created: boolean } {
  if (!path.isAbsolute(rawPath)) throw new Error('必须输入绝对路径');
  const p = path.resolve(rawPath);
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    throw new Error('路径不存在');
  }
  if (!st.isDirectory()) throw new Error('不是文件夹');
  if (p === NOVELS_ROOT || p.startsWith(NOVELS_ROOT + path.sep)) {
    throw new Error('该路径在内部小说目录里');
  }
  ensure();
  for (const m of byId.values()) {
    if (m.root === p) return { meta: m, created: false };
  }
  // 目录里已有 .wewrite/novel.json → 幂等重开（可能是索引丢了或目录被拷走）
  const existing = readNovelMeta(p, true, p);
  const meta: NovelMeta =
    existing ??
    {
      id: nextId(),
      title: path.basename(p) || '未命名小说',
      folder: p,
      created_at: nowStr(),
      updated_at: nowStr(),
      external: true,
      root: p,
    };
  try {
    writeNovelMeta(meta);
  } catch {
    throw new Error('无法写入该文件夹（无权限？）');
  }
  const list = readExternalList();
  if (!list.some((x) => x.path === p)) {
    list.push({ id: meta.id, path: p });
    writeExternalList(list);
  }
  markRegistryDirty();
  return { meta, created: !existing };
}

/** 重命名小说：内部=改目录名+novel.json；外部=只改 novel.json */
export function renameNovel(id: number, newTitle: string): NovelMeta {
  const meta = novelById(id);
  if (!meta) throw new Error('小说不存在');
  const title = String(newTitle ?? '').trim();
  if (!title) throw new Error('标题不能为空');
  if (title === meta.title) return meta;
  const now = nowStr();
  if (meta.external) {
    const updated: NovelMeta = { ...meta, title, updated_at: now };
    writeNovelMeta(updated);
    markRegistryDirty();
    return updated;
  }
  const newFolder = allocateFolderName(title);
  const newRoot = path.join(NOVELS_ROOT, newFolder);
  if (newFolder !== meta.folder) {
    if (fs.existsSync(newRoot)) throw new Error('同名文件夹已存在');
    fs.renameSync(meta.root, newRoot);
  }
  const updated: NovelMeta = { ...meta, title, folder: newFolder, root: newRoot, updated_at: now };
  writeNovelMeta(updated);
  markRegistryDirty();
  return updated;
}

/** 删除小说：内部=rm 目录；外部=摘除索引（不碰用户文件夹）；并清 detail_bank 镜像 */
export async function deleteNovel(id: number): Promise<void> {
  const meta = novelById(id);
  if (!meta) return;
  if (!meta.external) {
    // 注意：删除必须用 fs.promises.rm（异步）——紧跟大量 rename 后 rmSync 在 Windows 上会静默失败
    await fs.promises.rm(meta.root, { recursive: true, force: true });
  }
  const list = readExternalList();
  const filtered = list.filter((x) => x.id !== id && x.path !== meta.root);
  if (filtered.length !== list.length) writeExternalList(filtered);
  db.prepare('DELETE FROM detail_bank WHERE novel_id = ?').run(id);
  markRegistryDirty();
}

// ---- 迁移：novels 表 → 每部小说 .wewrite/novel.json + 生成 .registry.json 哨兵 ----

/** 幂等哨兵：.registry.json 存在即视为已迁移（哪怕损坏也不重迁） */
export function migrateNovelRegistry(): void {
  if (fs.existsSync(REGISTRY_FILE)) return;
  const rows = db.prepare('SELECT id, title, folder, created_at, updated_at FROM novels').all() as {
    id: number;
    title: string;
    folder: string;
    created_at: string;
    updated_at: string;
  }[];
  for (const r of rows) {
    if (!r.folder) continue;
    const root = path.join(NOVELS_ROOT, r.folder);
    fs.mkdirSync(root, { recursive: true });
    ensureWewriteDir(root);
    const file = path.join(root, '.wewrite', 'novel.json');
    if (fs.existsSync(file)) continue; // 已有则保留
    atomicWrite(
      file,
      JSON.stringify(
        {
          id: r.id,
          title: r.title,
          created_at: r.created_at,
          updated_at: r.updated_at,
        },
        null,
        2,
      ),
    );
  }
  writeExternalList([]);
  markRegistryDirty();
}

/** .wewrite 由 Phase 1 的空文件升级为目录：文件→rm+mkdir；目录→跳过；缺失→mkdir */
function ensureWewriteDir(root: string): void {
  const wp = path.join(root, '.wewrite');
  let st: fs.Stats | undefined;
  try {
    st = fs.lstatSync(wp);
  } catch {
    /* 缺失 */
  }
  if (st?.isDirectory()) return;
  // 必须是 unlinkSync：Windows 上 rmSync 对这类文件会静默失效（文件仍在，后续 mkdir EEXIST）
  if (st) fs.unlinkSync(wp);
  fs.mkdirSync(wp, { recursive: true });
}
