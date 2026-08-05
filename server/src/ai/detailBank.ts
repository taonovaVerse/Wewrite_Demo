import { db } from '../db.js';

export interface DetailHit {
  id: number;
  scene_type: string;
  sensory_channel: string;
  content: string;
  tags: string;
}

const STOP = new Set(
  '的了在是把我被你着她他们和与及就将着这那几个很都也就才又再不没有为而但却只呢吧啊呀么何何我们你们咱们自己这那之乎者',
);

/** 从场景提示中提取检索词：整段前缀 + 3 字滑窗（适配 FTS5 trigram 与中文子串匹配） */
export function extractTerms(scenePrompt: string, max = 8): string[] {
  const segments = scenePrompt.split(/[^一-鿿A-Za-z0-9]+/).filter(Boolean);
  const terms = new Set<string>();
  for (const seg of segments) {
    const meaningful = [...seg].filter((c) => !STOP.has(c));
    if (meaningful.length < 3) continue;
    const s = meaningful.join('');
    terms.add(s.slice(0, 8));
    for (let i = 0; i + 3 <= s.length; i++) {
      terms.add(s.slice(i, i + 3));
      if (terms.size >= max) break;
    }
    if (terms.size >= max) break;
  }
  return [...terms];
}

function escLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export function searchDetailBank(novelId: number, scenePrompt: string, limit = 3): DetailHit[] {
  const terms = extractTerms(scenePrompt, 8);

  if (terms.length > 0) {
    const query = terms.map((t) => `"${t.replace(/"/g, ' ')}"`).join(' OR ');
    try {
      const rows = db
        .prepare(
          `SELECT d.id, d.scene_type, d.sensory_channel, d.content, d.tags
           FROM detail_bank d
           JOIN detail_bank_fts f ON f.rowid = d.id
           WHERE d.novel_id = ? AND detail_bank_fts MATCH ?
           ORDER BY f.rank
           LIMIT ?`,
        )
        .all(novelId, query, limit);
      if (rows.length > 0) return rows as DetailHit[];
    } catch {
      // FTS 查询异常时降级到 LIKE
    }
  }

  const conditions = terms
    .map((t) => `(content LIKE ? ESCAPE '\\' OR scene_type LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')`)
    .join(' OR ');
  const args: unknown[] = [novelId];
  for (const t of terms) {
    const like = `%${escLike(t)}%`;
    args.push(like, like, like);
  }
  const rows = db
    .prepare(
      `SELECT id, scene_type, sensory_channel, content, tags
       FROM detail_bank
       WHERE novel_id = ? AND (${conditions || '1 = 0'})
       LIMIT ?`,
    )
    .all(...args, limit);
  return rows as DetailHit[];
}
