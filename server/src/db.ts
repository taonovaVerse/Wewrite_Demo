import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findDataDirArg(): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-dir' && argv[i + 1]) return argv[i + 1];
  }
  return undefined;
}

const DATA_DIR = findDataDirArg() ?? process.env.WEWRITE_DATA_DIR ?? path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'wewrite.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS novels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  order_idx  INTEGER NOT NULL DEFAULT 0,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  blueprint  TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'drafting',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

export function seedIfEmpty(): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM novels').get() as { n: number };
  if (count.n > 0) return;

  const insertNovel = db.prepare('INSERT INTO novels (title) VALUES (?)');
  const insertChapter = db.prepare(
    'INSERT INTO chapters (novel_id, order_idx, title, content) VALUES (?, ?, ?, ?)'
  );

  const novel = insertNovel.run('示例小说：雨夜便利店');
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
