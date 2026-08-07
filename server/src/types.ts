// 共享领域类型：章节文档（磁盘 .md）的解析结果 + 场景人物解析工具。
// 章节已从 chapters 表迁到 novels/<folder>/ 下的 .md 文件，字段含义：
//  - order_idx   = front-matter 的 order（文件夹内的顺序）
//  - folder      = 章节所在文件夹的相对路径（'' = 小说根目录）
//  - path        = 相对小说根的 .md 路径（如 '第一卷/第一章.md'）

/** 世界文档类型：6 类管理数据在磁盘 .docs/<类>/*.md 的 kind（人物关系为单例图边存储） */
export type DocKind = 'characters' | 'world' | 'foreshadow' | 'style' | 'bank' | 'relations';

/** 世界文档：从 .docs 文件解析的结果。fields 存结构化字段（front-matter，除 id），body 为正文 */
export interface DocRow {
  kind: DocKind;
  id: number;
  novel_id: number;
  title: string;
  body: string;
  fields: Record<string, string | number | null>;
  path: string;
}

export interface ChapterRow {
  id: number;
  novel_id: number;
  order_idx: number;
  title: string;
  content: string;
  blueprint: string;
  location: string;
  time_frame: string;
  emotion: string;
  theme: string;
  scene_characters: string;
  status: string;
  folder: string;
  path: string;
  created_at: string;
  updated_at: string;
}

/** 把「在场人物」字段（逗号分隔的人物 id 字符串）解析成整数 id 数组；非法/非正整数丢弃 */
export function parseSceneCharacterIds(sceneCharacters: string): number[] {
  return sceneCharacters
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}
