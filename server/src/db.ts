import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sanitizeName } from './fs/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findDataDirArg(): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-dir' && argv[i + 1]) return argv[i + 1];
  }
  return undefined;
}

export const DATA_DIR = findDataDirArg() ?? process.env.WEWRITE_DATA_DIR ?? path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'wewrite.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS novels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  folder     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  order_idx  INTEGER NOT NULL DEFAULT 0,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  blueprint        TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',
  time_frame       TEXT NOT NULL DEFAULT '',
  emotion          TEXT NOT NULL DEFAULT '',
  theme            TEXT NOT NULL DEFAULT '',
  scene_characters TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'drafting',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS characters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id       INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  profile        TEXT NOT NULL DEFAULT '',
  speaking_style TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS world_settings (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  key      TEXT NOT NULL,
  value    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS foreshadowing (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id          INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  planted_chapter   INTEGER,
  resolved_chapter  INTEGER,
  note              TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS style_profiles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id     INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  voice        TEXT NOT NULL DEFAULT '',
  rhythm_notes TEXT NOT NULL DEFAULT '',
  taboo_words  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS detail_bank (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id        INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  scene_type      TEXT NOT NULL DEFAULT '',
  sensory_channel TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL DEFAULT '',
  tags            TEXT NOT NULL DEFAULT ''
);

-- 全局发号器：novel/章节/世界文档共用一个单调计数器（insert-then-delete，AUTOINCREMENT 不复用 id）
CREATE TABLE IF NOT EXISTS ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);
`);

// 记录迁移前各业务表的最大 id，用于把全局发号器抬到不冲突的高水位（必须在 detail_bank 重建前取值）
const maxLegacyId = Math.max(
  (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM novels').get() as { m: number }).m,
  (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM chapters').get() as { m: number }).m,
  (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM detail_bank').get() as { m: number }).m,
);

// detail_bank 是 .docs/素材库 的纯镜像（启动时重灌），去掉它对 novels 表的外键——
// 外部小说的 novel_id 没有 novels 行，有 FK 会直接违反约束。数据零风险。
function dropDetailBankFk(): void {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DROP TABLE IF EXISTS detail_bank_fts;
    DROP TABLE IF EXISTS detail_bank;
    CREATE TABLE detail_bank (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id        INTEGER NOT NULL,
      scene_type      TEXT NOT NULL DEFAULT '',
      sensory_channel TEXT NOT NULL DEFAULT '',
      content         TEXT NOT NULL DEFAULT '',
      tags            TEXT NOT NULL DEFAULT ''
    );
  `);
  db.pragma('foreign_keys = ON');
}
dropDetailBankFk();

// 把 ids 表高水位推到旧库最大 id：显式插入一条再删除，sqlite_sequence 记住该值，后续 nextId 不会复用旧 id
function seedIdHighWater(): void {
  if (maxLegacyId <= 0) return;
  const r = db.prepare('INSERT INTO ids (id) VALUES (?)').run(maxLegacyId);
  db.prepare('DELETE FROM ids WHERE id = ?').run(r.lastInsertRowid);
}
seedIdHighWater();

/**
 * 重建素材库 FTS（detail_bank_fts 是 external-content FTS5 表，trigram）。
 * 必须在 detail_bank mirror 数据就绪后调用（index.ts 里 migrateAllDocs → rebuildDetailBankFts），
 * 否则新灌入的表数据不会进 FTS。
 */
export function rebuildDetailBankFts(): void {
  db.exec(`
    DROP TABLE IF EXISTS detail_bank_fts;
    DROP TRIGGER IF EXISTS detail_bank_ai;
    DROP TRIGGER IF EXISTS detail_bank_ad;
    DROP TRIGGER IF EXISTS detail_bank_au;

    CREATE VIRTUAL TABLE IF NOT EXISTS detail_bank_fts USING fts5(
      content,
      scene_type,
      tags,
      content='detail_bank',
      content_rowid='id',
      tokenize='trigram'
    );

    INSERT INTO detail_bank_fts(rowid, content, scene_type, tags)
    SELECT id, content, scene_type, tags FROM detail_bank;

    CREATE TRIGGER IF NOT EXISTS detail_bank_ai AFTER INSERT ON detail_bank BEGIN
      INSERT INTO detail_bank_fts(rowid, content, scene_type, tags)
      VALUES (new.id, new.content, new.scene_type, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS detail_bank_ad AFTER DELETE ON detail_bank BEGIN
      INSERT INTO detail_bank_fts(detail_bank_fts, rowid, content, scene_type, tags)
      VALUES ('delete', old.id, old.content, old.scene_type, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS detail_bank_au AFTER UPDATE ON detail_bank BEGIN
      INSERT INTO detail_bank_fts(detail_bank_fts, rowid, content, scene_type, tags)
      VALUES ('delete', old.id, old.content, old.scene_type, old.tags);
      INSERT INTO detail_bank_fts(rowid, content, scene_type, tags)
      VALUES (new.id, new.content, new.scene_type, new.tags);
    END;
  `);
}

// 老库升级：CREATE TABLE IF NOT EXISTS 不会补新列，检查缺失列后逐个 ALTER
const SCENE_COLUMNS = [
  'location',
  'time_frame',
  'emotion',
  'theme',
  'scene_characters',
] as const;

function ensureChapterSceneColumns(): void {
  const cols = new Set(
    (db.pragma('table_info(chapters)') as { name: string }[]).map((c) => c.name),
  );
  for (const col of SCENE_COLUMNS) {
    if (!cols.has(col)) {
      db.exec(`ALTER TABLE chapters ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    }
  }
}

ensureChapterSceneColumns();

/** 为小说分配唯一磁盘文件夹名：清洗标题 + 数值后缀去重（库内不重复） */
export function allocateNovelFolder(title: string): string {
  const base = sanitizeName(title || '未命名小说');
  const exists = (f: string) =>
    db.prepare('SELECT 1 FROM novels WHERE folder = ?').get(f) !== undefined;
  let folder = base;
  let k = 2;
  while (exists(folder)) folder = `${base} ${k++}`;
  return folder;
}

// novels 表加 folder 列（每部小说一个磁盘文件夹），老库按标题清洗回填
function ensureNovelFolderColumn(): void {
  const cols = new Set((db.pragma('table_info(novels)') as { name: string }[]).map((c) => c.name));
  if (!cols.has('folder')) {
    db.exec(`ALTER TABLE novels ADD COLUMN folder TEXT NOT NULL DEFAULT ''`);
  }
  const rows = db.prepare('SELECT id, title, folder FROM novels').all() as {
    id: number;
    title: string;
    folder: string;
  }[];
  for (const r of rows) {
    if (r.folder) continue;
    db.prepare('UPDATE novels SET folder = ? WHERE id = ?').run(allocateNovelFolder(r.title), r.id);
  }
}

ensureNovelFolderColumn();

export function seedIfEmpty(): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM novels').get() as { n: number };
  if (count.n > 0) return;

  const insertNovel = db.prepare('INSERT INTO novels (title, folder) VALUES (?, ?)');
  const insertChapter = db.prepare(
    'INSERT INTO chapters (novel_id, order_idx, title, content) VALUES (?, ?, ?, ?)'
  );

  const novel = insertNovel.run('示例小说：雨夜便利店', allocateNovelFolder('示例小说：雨夜便利店'));
  const sample = `雨下到后半夜，便利店的灯还亮着。

玻璃门开合的瞬间，冷风裹着雨腥气灌进来，货架最外面那排关东煮的蒸汽被吹得歪了一下。收银台后的男生抬起头，手里的《五年高考三年模拟》压着一支笔帽咬出牙印的圆珠笔。

她收了伞，伞尖在门口那块防滑垫上顿了顿，水顺着伞骨滴成一条线。

“一份萝卜，一份海带结。”她说。

男生低头去揭锅盖，蒸汽扑上他的脸。塑料碗递过去的时候，他多看了一眼——她右手的指甲剪得很短，虎口有茧，像是常年握什么东西的人。`;
  const chapter = insertChapter.run(novel.lastInsertRowid, 1, '第一章 雨夜', sample);
  db.prepare('INSERT INTO style_profiles (novel_id, voice) VALUES (?, ?)').run(
    novel.lastInsertRowid,
    '冷峻克制，白描为主，细节走具体物件与动作，避免抒情'
  );
}
