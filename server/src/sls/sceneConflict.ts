import type { SlsChecker, SlsDiagnostic } from './types.js';

/**
 * 场景冲突检查（规则型）。
 * 正文出现「第一次来到某地」类表述，但更早章节的 location 字段已到过该地 → 警告前后冲突（防吃书）。
 * 依赖章节细纲的 location 字段（此前 SLS 未使用），去重只报最早那章。
 */
export const sceneConflictChecker: SlsChecker = {
  id: 'scene-conflict',
  run(doc: string, ctx): SlsDiagnostic[] {
    if (ctx.priorLocations.length === 0) return [];
    const out: SlsDiagnostic[] = [];
    // 排除「不是/并非/非第一次」（此时恰好证明已去过，非冲突）；Node 24 支持定长交替后顾
    const re = /(?<!不是|并非|非)第一次(?:就|便)?(?:来到|走到|走进|踏进|抵达|进入|闯进|回到|赶到|踏上|踏入|踏足|来|到)([一-鿿]{2,8})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(doc)) !== null) {
      const place = stripPrefix(m[1]);
      if (place.length < 2) continue;
      const from = m.index + (m[0].length - m[1].length);
      const to = from + m[1].length;
      for (const pl of ctx.priorLocations) {
        if (place.includes(pl.location) || pl.location.includes(place)) {
          const at = pl.title ? `第 ${pl.seq} 章「${pl.title}」` : `第 ${pl.seq} 章`;
          out.push({
            from,
            to,
            severity: 'warning',
            source: 'scene-conflict',
            message: `人物首次到「${place}」——但${at}已在「${pl.location}」，前后冲突，请核对。`,
          });
          break; // 只报最早那章（priorLocations 已按 seq 升序且同地点去重）
        }
      }
    }
    return out;
  },
};

/** 去掉捕获串开头的连缀虚字，防「第一次来到这青州」被误读成地点「这青州」 */
function stripPrefix(s: string): string {
  let i = 0;
  while (i < s.length && PREFIX_STOP.has(s[i])) i++;
  return s.slice(i);
}

const PREFIX_STOP = new Set('这那在从往向到把将');
