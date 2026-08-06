import matter from 'gray-matter';

/**
 * 章节 .md 的 front-matter 解析/序列化。
 * 关键：解析返回完整 data（含作者手写的未知字段），写回时只合并已知字段、
 * 保留未知字段——作者在 VSCode 里手改 front-matter 不会丢数据。
 */

export interface ChapterMeta {
  id?: number;
  order?: number;
  title?: string;
  location?: string;
  time_frame?: string;
  emotion?: string;
  theme?: string;
  scene_characters?: string;
  blueprint?: string;
  status?: string;
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asId(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** 从 YAML data 里抽取章节已知字段；data 为作者可能手写的完整对象 */
export function extractMeta(data: Record<string, unknown>): ChapterMeta {
  return {
    id: asId(data.id),
    order: asId(data.order),
    title: data.title !== undefined ? asString(data.title) : undefined,
    location: asString(data.location),
    time_frame: asString(data.time_frame),
    emotion: asString(data.emotion),
    theme: asString(data.theme),
    scene_characters: asString(data.scene_characters),
    blueprint: asString(data.blueprint),
    status: asString(data.status),
  };
}

/** 解析章节文件原文 → 完整 YAML data + 正文（body）。无 front-matter 时 data 为空对象 */
export function parseChapterFile(raw: string): { data: Record<string, unknown>; body: string } {
  const norm = String(raw ?? '').replace(/\r\n/g, '\n');
  const { data, content } = matter(norm);
  return {
    data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
    body: content ?? '',
  };
}

/**
 * 把「完整 data + 正文」序列化成 .md。data 为空则只写正文。
 * 正文首行为 `---` 时补一个空行，避免被误判成 front-matter 分隔线。
 */
export function serializeChapterFile(data: Record<string, unknown>, body: string): string {
  if (Object.keys(data).length === 0) {
    return body.startsWith('---') ? `\n${body}` : body;
  }
  const content = body.startsWith('---') ? `\n${body}` : body;
  return matter.stringify(content, data, { language: 'yaml' });
}
