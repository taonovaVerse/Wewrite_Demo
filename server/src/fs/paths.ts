import fs from 'node:fs';
import path from 'node:path';

// Windows 文件名非法字符
const ILLEGAL_RE = /[<>:"/\\|?*]/g;
const ILLEGAL_TEST = /[<>:"/\\|?*]/;

/** 清洗文件名/文件夹名：去掉非法字符、结尾的点与空格；空则兜底 */
export function sanitizeName(name: string): string {
  const cleaned = String(name ?? '')
    .replace(ILLEGAL_RE, '')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || '未命名';
}

/** 用户提供的相对路径归一化为安全相对路径（POSIX 风格）；含非法段则抛错 */
export function safeRelPath(rel: string): string {
  const normalized = String(rel ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
  if (!normalized) return '';
  const parts = normalized.split('/').filter((p) => p !== '' && p !== '.');
  for (const p of parts) {
    if (p === '..' || ILLEGAL_TEST.test(p)) {
      throw new Error(`非法路径: ${p}`);
    }
  }
  return parts.join('/');
}

/** 把相对路径安全解析到 root 内（拒绝越界与绝对路径） */
export function resolveNovelPath(root: string, rel: string): string {
  const safe = safeRelPath(rel);
  const abs = path.resolve(root, ...safe.split('/'));
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error(`路径越界: ${rel}`);
  }
  return abs;
}

/** 原子写：先写临时文件再 rename 覆盖，防崩溃留下半截文件（Windows 下 rename 覆盖旧文件） */
export function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 清理失败不影响主错误 */
    }
    throw err;
  }
}

/** 向上清理空目录（用于删除/移动章节后收尾），遇到非空即停 */
export function cleanupEmptyDirs(root: string, relDir: string): void {
  let rel = relDir;
  while (rel) {
    const abs = path.join(root, rel);
    try {
      if (fs.readdirSync(abs).length > 0) break;
      fs.rmdirSync(abs);
    } catch {
      break;
    }
    rel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  }
}
