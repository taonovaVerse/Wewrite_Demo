import { db } from '../db.js';
import {
  AUTOCOMPLETE_SYSTEM,
  CONTINUE_SYSTEM,
  DETAIL_SYSTEM,
  formatAutocompleteUser,
  formatContinueUser,
  formatDetailUser,
} from './prompts.js';
import type { ContinueContext, DetailContext } from './prompts.js';
import { searchDetailBank } from './detailBank.js';

export interface ChapterRow {
  id: number;
  novel_id: number;
  order_idx: number;
  title: string;
  content: string;
  blueprint: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const getChapterStmt = db.prepare('SELECT * FROM chapters WHERE id = ?');
const getStyleStmt = db.prepare('SELECT * FROM style_profiles WHERE novel_id = ?');
const getCharactersStmt = db.prepare('SELECT * FROM characters WHERE novel_id = ?');
const getSettingsStmt = db.prepare('SELECT * FROM world_settings WHERE novel_id = ?');
const getForeshadowStmt = db.prepare(
  'SELECT * FROM foreshadowing WHERE novel_id = ? AND resolved_chapter IS NULL'
);

export function getChapter(id: number): ChapterRow | undefined {
  return getChapterStmt.get(id) as ChapterRow | undefined;
}

function simpleSummary(content: string, max = 500): string {
  const trimmed = content.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + '……（后续见最近正文）';
}

export function assembleContinue(chapter: ChapterRow): {
  system: string;
  user: string;
  cachePrefix: boolean;
} {
  const style =
    (getStyleStmt.get(chapter.novel_id) as {
      voice: string;
      rhythm_notes: string;
      taboo_words: string;
    } | undefined) ?? { voice: '', rhythm_notes: '', taboo_words: '' };

  const characters = getCharactersStmt.all(chapter.novel_id) as ContinueContext['characters'];
  const settings = getSettingsStmt.all(chapter.novel_id) as ContinueContext['settings'];
  const foreshadowing = (getForeshadowStmt.all(chapter.novel_id) as { note: string }[]).map(
    (f) => f.note,
  );

  const ctx: ContinueContext = {
    style,
    characters,
    settings,
    foreshadowing,
    blueprint: chapter.blueprint,
    summary: simpleSummary(chapter.content),
    recent: chapter.content.slice(-4000),
  };

  return { system: CONTINUE_SYSTEM, user: formatContinueUser(ctx), cachePrefix: true };
}

export function assembleAutocomplete(
  chapter: ChapterRow,
  textBefore: string,
  textAfter: string,
): { system: string; user: string; cachePrefix: boolean } {
  const style =
    (getStyleStmt.get(chapter.novel_id) as {
      voice: string;
      taboo_words: string;
    } | undefined) ?? { voice: '', taboo_words: '' };

  return {
    system: AUTOCOMPLETE_SYSTEM,
    user: formatAutocompleteUser({ style, before: textBefore, after: textAfter }),
    cachePrefix: true,
  };
}

export function assembleDetail(
  chapter: ChapterRow,
  scenePrompt: string,
  before: string,
): { system: string; user: string; cachePrefix: boolean; sources: string[] } {
  const style =
    (getStyleStmt.get(chapter.novel_id) as {
      voice: string;
      taboo_words: string;
    } | undefined) ?? { voice: '', taboo_words: '' };

  const hits = searchDetailBank(chapter.novel_id, scenePrompt, 3);
  const ctx: DetailContext = {
    style,
    scenePrompt,
    before,
    examples: hits.map((h) => h.content),
  };

  return {
    system: DETAIL_SYSTEM,
    user: formatDetailUser(ctx),
    cachePrefix: true,
    sources: ctx.examples,
  };
}
