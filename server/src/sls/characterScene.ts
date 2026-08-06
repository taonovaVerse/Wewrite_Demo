import type { SlsChecker, SlsDiagnostic } from './types.js';
import { findAll } from './util.js';

/**
 * 场景人物检查（规则型）。
 * 依赖章节的「在场人物」字段：作者在「章节细纲」视图勾选了场景人物清单后，
 * 正文里出现清单之外的人物时提示，防止角色无声无息乱入场景（防吃书）。
 * 未设置场景人物时跳过，保持对老章节零打扰。
 */
export const characterSceneChecker: SlsChecker = {
  id: 'character-scene',
  run(doc: string, ctx): SlsDiagnostic[] {
    if (ctx.sceneCharacterIds.length === 0) return [];
    const inScene = new Set(ctx.sceneCharacterIds);
    const out: SlsDiagnostic[] = [];
    for (const ch of ctx.characters) {
      if (inScene.has(ch.id)) continue;
      const name = ch.name.trim();
      if (!name) continue;
      for (const { from, to } of findAll(doc, name)) {
        out.push({
          from,
          to,
          severity: 'info',
          source: 'character-scene',
          message: `人物「${name}」不在本章「在场人物」清单。若确在场，请到「章节细纲」视图勾选。`,
        });
      }
    }
    return out;
  },
};
