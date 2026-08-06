import { Router } from 'express';
import type { Request, Response } from 'express';
import { novelById } from '../fs/registry.js';
import {
  listVersions,
  getVersionDiff,
  restoreVersion,
  snapshotNow,
} from '../fs/versioning.js';

export const versioningRouter = Router();

const HASH_RE = /^[0-9a-f]{40}$/i;

function novelIdOf(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !novelById(id)) {
    res.status(404).json({ error: '小说不存在' });
    return null;
  }
  return id;
}

function hashOf(req: Request, res: Response): string | null {
  const hash = String(req.params.hash ?? '');
  if (!HASH_RE.test(hash)) {
    res.status(400).json({ error: '无效的版本号' });
    return null;
  }
  return hash;
}

// 历史版本列表（enabled:false = 该小说目录已有自己的 git 仓库，未接管）
versioningRouter.get('/:id/versions', async (req, res) => {
  const novelId = novelIdOf(req, res);
  if (novelId === null) return;
  try {
    res.json(await listVersions(novelId));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '读取历史失败' });
  }
});

// 某版本相对其父版本的统一 diff
versioningRouter.get('/:id/versions/:hash', async (req, res) => {
  const novelId = novelIdOf(req, res);
  if (novelId === null) return;
  const hash = hashOf(req, res);
  if (hash === null) return;
  try {
    res.json(await getVersionDiff(novelId, hash));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '读取差异失败' });
  }
});

// 手动立即快照
versioningRouter.post('/:id/versions', async (req, res) => {
  const novelId = novelIdOf(req, res);
  if (novelId === null) return;
  try {
    res.json(await snapshotNow(novelId));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '快照失败' });
  }
});

// 回滚到历史版本
versioningRouter.post('/:id/versions/:hash/restore', async (req, res) => {
  const novelId = novelIdOf(req, res);
  if (novelId === null) return;
  const hash = hashOf(req, res);
  if (hash === null) return;
  try {
    res.json(await restoreVersion(novelId, hash));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '恢复失败' });
  }
});
