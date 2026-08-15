import { getChapterById } from '../fs/novelFs.js';
import { getStyleDoc, listKindDocs } from '../fs/docFs.js';
import { parseSceneCharacterIds, type ChapterRow, type DocRow } from '../types.js';
import {
  ASSISTANT_SYSTEM,
  AUTOCOMPLETE_SYSTEM,
  CONTINUE_SYSTEM,
  DETAIL_SYSTEM,
  REWRITE_SYSTEM,
  formatAssistantUser,
  formatAutocompleteUser,
  formatContinueUser,
  formatDetailUser,
  formatMetrics,
  type AssistantContext,
  type ContinueContext,
  type DetailContext,
  type Scene,
  type CharacterCtx,
} from './prompts.js';
import { searchDetailBank } from './detailBank.js';
import { analyzeChapters } from '../style/analyzer.js';

// 世界文档（人物卡/世界观/伏笔/文风）已迁到 .docs 文件，AI 上下文统一从磁盘读，不再查 SQLite 表。

/** 章节已落盘为 .md，统一从磁盘读 */
export function getChapter(id: number): ChapterRow | undefined {
  return getChapterById(id);
}

function extractScene(chapter: ChapterRow): Scene {
  return {
    location: chapter.location,
    time_frame: chapter.time_frame,
    emotion: chapter.emotion,
    theme: chapter.theme,
  };
}

function getStyle(novelId: number): { voice: string; rhythm_notes: string; taboo_words: string } {
  const doc = getStyleDoc(novelId);
  return {
    voice: String(doc?.fields.voice ?? ''),
    rhythm_notes: String(doc?.fields.rhythm_notes ?? ''),
    taboo_words: String(doc?.fields.taboo_words ?? ''),
  };
}

function toCharCtx(d: DocRow): CharacterCtx {
  return {
    name: String(d.fields.name ?? ''),
    profile: String(d.fields.profile ?? ''),
    speaking_style: String(d.fields.speaking_style ?? ''),
    status: String(d.fields.status ?? ''),
  };
}

/** 有在场人物 id 时只取这些人物卡，否则回退该小说全部人物（id 过滤改为内存） */
function getSceneCharacters(novelId: number, ids: number[]): CharacterCtx[] {
  const docs = listKindDocs(novelId, 'characters');
  if (ids.length === 0) return docs.map(toCharCtx);
  const set = new Set(ids);
  return docs.filter((d) => set.has(d.id)).map(toCharCtx);
}

function getSettings(novelId: number): ContinueContext['settings'] {
  return listKindDocs(novelId, 'world').map((d) => ({
    key: String(d.fields.key ?? ''),
    value: String(d.fields.value ?? ''),
  }));
}

function getUnresolvedForeshadow(novelId: number): string[] {
  return listKindDocs(novelId, 'foreshadow')
    .filter((d) => d.fields.resolved_chapter == null)
    .map((d) => String(d.fields.note ?? ''));
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
  const style = getStyle(chapter.novel_id);
  const characters = getSceneCharacters(
    chapter.novel_id,
    parseSceneCharacterIds(chapter.scene_characters),
  );
  const settings = getSettings(chapter.novel_id);
  const foreshadowing = getUnresolvedForeshadow(chapter.novel_id);

  const ctx: ContinueContext = {
    style,
    scene: extractScene(chapter),
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
  const style = getStyle(chapter.novel_id);
  const characters = getSceneCharacters(
    chapter.novel_id,
    parseSceneCharacterIds(chapter.scene_characters),
  );

  return {
    system: AUTOCOMPLETE_SYSTEM,
    user: formatAutocompleteUser({
      style,
      scene: { location: chapter.location, time_frame: chapter.time_frame },
      characters,
      before: textBefore,
      after: textAfter,
    }),
    cachePrefix: true,
  };
}

export function assembleDetail(
  chapter: ChapterRow,
  scenePrompt: string,
  before: string,
): { system: string; user: string; cachePrefix: boolean; sources: string[] } {
  const style = getStyle(chapter.novel_id);
  const hits = searchDetailBank(chapter.novel_id, scenePrompt, 3);
  const ctx: DetailContext = {
    style,
    scene: extractScene(chapter),
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

/** AI 助手：多轮对话（全书上下文 + 全部人物卡 + 当前章文风指标 + 正文）与改写写回 */
export function assembleAssistant(
  chapter: ChapterRow,
  messages: { role: 'user' | 'assistant'; content: string }[],
  mode: 'ask' | 'rewrite',
  originalText?: string,
): { system: string; user: string; cachePrefix: boolean } {
  const style = getStyle(chapter.novel_id);
  const characters = getSceneCharacters(chapter.novel_id, []); // 全书范围：全部人物卡，非场景过滤
  const settings = getSettings(chapter.novel_id);
  const foreshadowing = getUnresolvedForeshadow(chapter.novel_id);
  const { metrics } = analyzeChapters([chapter]); // 单章扫描，便宜
  const MAX = 8000;
  const chapterText =
    chapter.content.length > MAX
      ? chapter.content.slice(0, MAX) + '\n……（正文过长，以上为节选）'
      : chapter.content;

  // 多轮历史：末 12 轮、每轮 ≤2000 字（不含当前轮；当前轮由 mode/question/originalText 表达）
  const history = messages
    .slice(0, -1)
    .slice(-12)
    .map((m) => ({
      role: m.role,
      content: m.content.length > 2000 ? m.content.slice(0, 2000) + '……（已截断）' : m.content,
    }));
  const question = messages[messages.length - 1]?.content ?? '';

  const ctx: AssistantContext = {
    style,
    scene: extractScene(chapter),
    characters,
    settings,
    foreshadowing,
    blueprint: chapter.blueprint,
    metrics: formatMetrics(metrics),
    chapterText,
    history,
    mode,
    question,
    originalText,
  };

  return {
    system: mode === 'rewrite' ? REWRITE_SYSTEM : ASSISTANT_SYSTEM,
    user: formatAssistantUser(ctx),
    cachePrefix: true,
  };
}
