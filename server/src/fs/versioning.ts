import fs from 'node:fs';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { structuredPatch } from 'diff';
import { novelRoot } from './registry.js';
import { invalidateChapterIndex } from './novelFs.js';
import { syncBankMirror } from './docFs.js';

// ---- 每部小说一个真实 git 仓库（isomorphic-git 纯 JS）：懒建仓 + 防抖自动快照 + 历史/差异/回滚 ----

const GIT_AUTHOR = { name: 'Wewrite', email: 'wewrite@local' };
const GITIGNORE_CONTENT = ['.wewrite/', '*.tmp', '.docs/素材库/'].join('\n') + '\n';
const DEBOUNCE_MS = 1500;

// 每部小说的懒初始化标记（root 每次现查，避免小说改名后路径过期）
const repoFlags = new Map<number, { enabled: boolean; initialized: boolean }>();
// 防抖 timer：内容类保存后合并为一次 commit
const timers = new Map<number, { timeout: NodeJS.Timeout; message: string }>();
// 同 repo 的 git 操作串行，避免并发 index 损坏
const chains = new Map<number, Promise<unknown>>();

export interface VersionInfo {
  hash: string;
  date: string;
  message: string;
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  text: string;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  lines: DiffLine[];
}

function nowStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function flags(novelId: number): { enabled: boolean; initialized: boolean } | null {
  const f = repoFlags.get(novelId);
  if (f) return f;
  const root = novelRoot(novelId);
  if (!root || !fs.existsSync(root)) return null;
  const init = { enabled: !fs.existsSync(path.join(root, '.git')), initialized: false };
  repoFlags.set(novelId, init);
  return init;
}

/** 懒建仓：写 .gitignore；目录里已有别人的 .git → 不接管（enabled:false） */
async function ensureRepo(novelId: number): Promise<{ root: string; enabled: boolean }> {
  const f = flags(novelId);
  if (!f) return { root: '', enabled: false };
  if (f.initialized) return { root: novelRoot(novelId)!, enabled: f.enabled };
  f.initialized = true;
  const root = novelRoot(novelId)!;
  if (fs.existsSync(path.join(root, '.git'))) {
    f.enabled = false;
    return { root, enabled: false };
  }
  await git.init({ fs, dir: root, defaultBranch: 'main' });
  fs.writeFileSync(path.join(root, '.gitignore'), GITIGNORE_CONTENT, 'utf8');
  return { root, enabled: true };
}

/** 串行执行同 repo 的 git 操作；返回本次任务结果，链上吞掉错误避免断链 */
function enqueue<T>(novelId: number, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(novelId) ?? Promise.resolve();
  const next = prev.then(task, task);
  chains.set(novelId, next.then(() => undefined, () => undefined));
  return next;
}

/** 提交当前工作区（statusMatrix 无变化则跳过，避免无意义 commit） */
async function snapshotNovel(novelId: number, message?: string): Promise<{ committed: boolean }> {
  // ensureRepo 也放进链内：首次快照时 git.init 与后续操作串行，避免并发 init 竞态
  return enqueue(novelId, async () => {
    const st = await ensureRepo(novelId);
    if (!st.enabled) return { committed: false };
    let hasChanges = true;
    try {
      const matrix = await git.statusMatrix({ fs, dir: st.root });
      hasChanges = matrix.some((row) => row[1] !== row[2] || row[2] !== row[3]);
    } catch {
      hasChanges = true; // 无 HEAD（首提）或异常 → 保守提交
    }
    if (!hasChanges) return { committed: false };
    await git.add({ fs, dir: st.root, filepath: '.' });
    await git.commit({
      fs,
      dir: st.root,
      author: GIT_AUTHOR,
      committer: GIT_AUTHOR,
      message: message ?? `自动保存 ${nowStr()}`,
    });
    return { committed: true };
  });
}

/** 内容类保存后防抖 1.5s 自动快照 */
export function scheduleSnapshot(novelId: number, message?: string): void {
  const prev = timers.get(novelId);
  if (prev) clearTimeout(prev.timeout);
  const entry = {
    timeout: undefined as unknown as NodeJS.Timeout,
    message: message ?? `自动保存 ${nowStr()}`,
  };
  entry.timeout = setTimeout(() => {
    timers.delete(novelId);
    void snapshotNovel(novelId, entry.message).catch((e) =>
      console.warn(`[versioning] 自动快照失败 (novel ${novelId})`, e),
    );
  }, DEBOUNCE_MS);
  timers.set(novelId, entry);
}

/** 结构性操作 / 手动快照：清掉待定 timer 并立即提交 */
export async function snapshotNow(novelId: number): Promise<{ committed: boolean }> {
  const t = timers.get(novelId);
  if (t) {
    clearTimeout(t.timeout);
    timers.delete(novelId);
  }
  try {
    return await snapshotNovel(novelId, t?.message);
  } catch (e) {
    console.warn(`[versioning] 立即快照失败 (novel ${novelId})`, e);
    return { committed: false };
  }
}

export function cancelPending(novelId: number): void {
  const t = timers.get(novelId);
  if (t) {
    clearTimeout(t.timeout);
    timers.delete(novelId);
  }
}

/** 关闭进程前兜底：把待定防抖快照立即提交，等所有 git 操作收尾 */
export async function flushAllPending(): Promise<void> {
  const ids = [...timers.keys()];
  await Promise.allSettled(ids.map((id) => snapshotNow(id)));
  await Promise.allSettled([...chains.values()]);
}

/** 进程收到 SIGINT/SIGTERM 时尽力 flush，然后退出 */
export function registerShutdownFlush(): void {
  let flushing = false;
  const shutdown = () => {
    if (flushing) return;
    flushing = true;
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref();
    void flushAllPending().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export async function listVersions(
  novelId: number,
): Promise<{ enabled: boolean; versions: VersionInfo[] }> {
  const f = flags(novelId);
  if (!f) return { enabled: false, versions: [] };
  const root = novelRoot(novelId)!;
  if (!f.initialized) {
    if (fs.existsSync(path.join(root, '.git'))) {
      f.initialized = true;
      f.enabled = false;
      return { enabled: false, versions: [] };
    }
    return { enabled: true, versions: [] }; // 已启用但还没快照过
  }
  if (!f.enabled) return { enabled: false, versions: [] };
  return enqueue(novelId, async () => {
    let commits: { oid: string; commit: { committer: { timestamp: number }; message: string } }[] = [];
    try {
      commits = await git.log({ fs, dir: root });
    } catch {
      commits = [];
    }
    return {
      enabled: true,
      versions: commits.map((c) => ({
        hash: c.oid,
        date: new Date(c.commit.committer.timestamp * 1000).toISOString(),
        message: c.commit.message.trim(),
      })),
    };
  });
}

/** 递归收集某 commit 的完整文件表（oid=null → 空树，用于根 commit 与空比） */
async function collectTree(
  root: string,
  oid: string,
  prefix: string,
  out: Map<string, string>,
): Promise<void> {
  const { tree } = await git.readTree({ fs, dir: root, oid });
  for (const entry of tree) {
    const rel = prefix ? `${prefix}/${entry.path}` : entry.path;
    if (entry.type === 'tree') {
      await collectTree(root, entry.oid, rel, out);
    } else if (entry.type === 'blob') {
      const { blob } = await git.readBlob({ fs, dir: root, oid: entry.oid });
      out.set(rel, Buffer.from(blob).toString('utf8'));
    }
  }
}

async function treeFiles(root: string, oid: string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (oid) await collectTree(root, oid, '', out);
  return out;
}

function buildDiff(p: string, a: string, b: string): DiffFile {
  const patch = structuredPatch(p, p, a, b, '', '', { context: 2 });
  let added = 0;
  let removed = 0;
  const lines: DiffLine[] = [];
  for (const h of patch.hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) added++;
      else if (l.startsWith('-')) removed++;
    }
  }
  for (const h of patch.hunks) {
    lines.push({
      type: 'hunk',
      text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    });
    for (const l of h.lines) {
      const first = l.charAt(0);
      if (first === '\\') {
        lines.push({ type: 'meta', text: l }); // 「\ No newline at end of file」标记
      } else {
        const text = l.slice(1).replace(/\r$/, '');
        if (first === '+') lines.push({ type: 'add', text });
        else if (first === '-') lines.push({ type: 'del', text });
        else lines.push({ type: 'ctx', text });
      }
    }
  }
  return { path: p, added, removed, lines };
}

/** 某版本相对其父版本的统一 diff（根版本与空树比） */
export async function getVersionDiff(novelId: number, hash: string): Promise<DiffFile[]> {
  const st = await ensureRepo(novelId);
  if (!st.enabled) throw new Error('未启用版本管理');
  return enqueue(novelId, async () => {
    const commit = await git.readCommit({ fs, dir: st.root, oid: hash });
    const parentOid = commit.commit.parent[0] ?? null;
    const [before, after] = await Promise.all([
      treeFiles(st.root, parentOid),
      treeFiles(st.root, hash),
    ]);
    const paths = new Set([...before.keys(), ...after.keys()]);
    const files: DiffFile[] = [];
    for (const p of paths) {
      const a = before.get(p);
      const b = after.get(p);
      if (a === b) continue;
      files.push(buildDiff(p, a ?? '', b ?? ''));
    }
    return files;
  });
}

/** 回滚到历史版本：先 flush 当前未提交改动，再硬重置工作区到目标 commit */
export async function restoreVersion(novelId: number, hash: string): Promise<{ restored: boolean }> {
  cancelPending(novelId);
  await snapshotNow(novelId); // 先把当前状态落库，避免回滚丢掉
  const st = await ensureRepo(novelId);
  if (!st.enabled) throw new Error('未启用版本管理');
  await enqueue(novelId, async () => {
    await git.checkout({ fs, dir: st.root, ref: hash, force: true });
    invalidateChapterIndex(); // 章节 id → 路径 索引失效，下次读取重新扫描磁盘
    syncBankMirror(novelId); // detail_bank 镜像重灌（.docs/素材库 不进 git）
  });
  return { restored: true };
}
