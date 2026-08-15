import type { ChapterRow } from '../types.js';
import { extractTerms, searchDetailBank } from './detailBank.js';

/** 助手「查资料」命中项：kind 区分全书章节片段与素材库条目 */
export interface BookSource {
  kind: 'chapter' | 'bank';
  title: string;
  excerpt: string;
}

const EXCERPT_MAX = 400;

/** 按空行切段，贪心聚桶到 ~target 字（上限 cap），作为检索单元 */
export function splitChapterPassages(content: string, target = 300, cap = 400): string[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const passages: string[] = [];
  let bucket = '';
  for (const p of paragraphs) {
    if (bucket && bucket.length + p.length > target) {
      passages.push(bucket);
      bucket = p;
    } else {
      bucket = bucket ? `${bucket}\n${p}` : p;
    }
    if (bucket.length >= cap) {
      passages.push(bucket);
      bucket = '';
    }
  }
  if (bucket) passages.push(bucket);
  return passages;
}

function clamp(text: string): string {
  return text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX) + '…' : text;
}

/**
 * 每轮自动检索：全书章节片段（extractTerms 取词，按词出现次数计分，每章至多 maxPerChapter 条）
 * + 素材库 FTS 命中。检索词为空时只回素材库结果（通常也为空）。
 */
export function retrieveBookSources(
  novelId: number,
  question: string,
  chapters: ChapterRow[],
  opts: { top?: number; maxPerChapter?: number } = {},
): BookSource[] {
  const { top = 5, maxPerChapter = 2 } = opts;
  const terms = extractTerms(question, 8);
  const chapterSources: BookSource[] = [];

  if (terms.length > 0) {
    const scored: { chapterId: number; title: string; text: string; score: number }[] = [];
    for (const ch of chapters) {
      for (const text of splitChapterPassages(ch.content)) {
        let score = 0;
        for (const t of terms) {
          let i = 0;
          while ((i = text.indexOf(t, i)) !== -1) {
            score++;
            i += t.length;
          }
        }
        if (score > 0) scored.push({ chapterId: ch.id, title: ch.title, text, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    // 每章限条数，防单章刷屏；再截 top
    const perChapter = new Map<number, number>();
    for (const s of scored) {
      const n = perChapter.get(s.chapterId) ?? 0;
      if (n >= maxPerChapter) continue;
      perChapter.set(s.chapterId, n + 1);
      chapterSources.push({
        kind: 'chapter',
        title: s.title || `第${s.chapterId}章`,
        excerpt: clamp(s.text),
      });
      if (chapterSources.length >= top) break;
    }
  }

  const bankSources: BookSource[] = searchDetailBank(novelId, question, 3).map((h) => ({
    kind: 'bank',
    title: h.scene_type || '素材库',
    excerpt: clamp(h.content),
  }));

  return [...chapterSources, ...bankSources];
}
