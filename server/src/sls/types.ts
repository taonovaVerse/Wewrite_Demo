// 轻量 SLS（Story Language Server）共享类型。
// 扩展方式：新建检查器文件，实现 SlsChecker 接口，
// 然后在 sls/index.ts 的 checkers 数组里注册即可。

/** 诊断严重级别（与 CodeMirror lint 的 severity 对齐） */
export type Severity = 'error' | 'warning' | 'info';

/** 一条诊断：编辑器据此在正文上画波浪线 */
export interface SlsDiagnostic {
  /** 命中文本的起始偏移（相对被检查的整段正文，from 含 / to 不含） */
  from: number;
  to: number;
  severity: Severity;
  /** 给作者看的中文提示 */
  message: string;
  /** 来源标识，如 taboo / character-scene / foreshadow */
  source: string;
}

/** 供检查器使用的上下文：由路由层一次查库组装，检查器保持纯函数、可单测 */
export interface SlsContext {
  novelId: number;
  /** 小说全部人物（用于比对正文里出现谁） */
  characters: { id: number; name: string }[];
  /** 本章「在场人物」id（来自章节 scene_characters 字段，空表示未设置） */
  sceneCharacterIds: number[];
  /** 本小说更早章节的正文（回响/伏笔检索引用），按章节倒序 */
  priorChapters: string[];
  /** 未完结的伏笔条目（resolved_chapter 为空） */
  foreshadowNotes: string[];
}

/** 检查器契约：入参 (正文, 上下文)，返回若干诊断 */
export interface SlsChecker {
  id: string;
  run(doc: string, ctx: SlsContext): SlsDiagnostic[];
}
