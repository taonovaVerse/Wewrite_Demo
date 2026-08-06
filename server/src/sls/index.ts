import { listChaptersInOrder } from '../fs/novelFs.js';
import { listKindDocs } from '../fs/docFs.js';
import { parseSceneCharacterIds, type ChapterRow } from '../types.js';
import { tabooChecker } from './taboo.js';
import { characterSceneChecker } from './characterScene.js';
import { foreshadowChecker } from './foreshadow.js';
import type { SlsChecker, SlsContext, SlsDiagnostic } from './types.js';

// 已注册的检查器。扩展 SLS：新建检查器文件，实现 SlsChecker 接口，加到数组即可。
const checkers: SlsChecker[] = [tabooChecker, characterSceneChecker, foreshadowChecker];

// 回响检索最多回看最近几章，控制成本
const PRIOR_CHAPTER_LIMIT = 8;

/** 组装检查上下文：一次查库/读盘，交给各检查器复用（检查器保持纯函数） */
function buildSlsContext(chapter: ChapterRow): SlsContext {
  const characters = listKindDocs(chapter.novel_id, 'characters').map((d) => ({
    id: d.id,
    name: String(d.fields.name ?? ''),
  }));
  // 前文 = 按深度优先树序位于当前章节之前的章节；回响只取每章开头一段（欠采样，少提示比多噪音安全）
  const all = listChaptersInOrder(chapter.novel_id);
  const idx = all.findIndex((c) => c.id === chapter.id);
  const priorChapters = (idx === -1 ? all : all.slice(0, idx))
    .slice(-PRIOR_CHAPTER_LIMIT)
    .map((c) => c.content.slice(0, 1000));
  const foreshadowNotes = listKindDocs(chapter.novel_id, 'foreshadow')
    .filter((d) => d.fields.resolved_chapter == null)
    .map((d) => String(d.fields.note ?? ''));
  return {
    novelId: chapter.novel_id,
    characters,
    sceneCharacterIds: parseSceneCharacterIds(chapter.scene_characters),
    priorChapters,
    foreshadowNotes,
  };
}

/** 对整段正文跑全部已注册检查器，聚合诊断并按位置排序（编辑器渲染更友好） */
export function runSlsCheck(doc: string, chapter: ChapterRow): SlsDiagnostic[] {
  const ctx = buildSlsContext(chapter);
  const out: SlsDiagnostic[] = [];
  for (const checker of checkers) {
    out.push(...checker.run(doc, ctx));
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}
