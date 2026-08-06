import { Router } from 'express';
import { createFolder, deleteFolder, moveChapter, renameFolder } from '../fs/novelFs.js';
import { novelById } from '../fs/registry.js';
import { snapshotNow } from '../fs/versioning.js';

export const treeRouter = Router();

/** 新建文件夹：body = { name, parent }，返回其相对路径（相对小说根） */
treeRouter.post('/novels/:id/folders', (req, res) => {
  const novelId = Number(req.params.id);
  if (!novelById(novelId)) {
    res.status(404).json({ error: '小说不存在' });
    return;
  }
  const name = String(req.body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'name 不能为空' });
    return;
  }
  const parent = String(req.body?.parent ?? '').trim();
  const folder = createFolder(novelId, name, parent);
  void snapshotNow(novelId);
  res.status(201).json({ folder });
});

/** 重命名文件夹：body = { folder, name } */
treeRouter.post('/novels/:id/folders/rename', (req, res) => {
  const novelId = Number(req.params.id);
  const folder = String(req.body?.folder ?? '').trim();
  const name = String(req.body?.name ?? '').trim();
  if (!folder || !name) {
    res.status(400).json({ error: 'folder/name 不能为空' });
    return;
  }
  try {
    const renamed = renameFolder(novelId, folder, name);
    void snapshotNow(novelId);
    res.json({ folder: renamed });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '重命名失败' });
  }
});

/** 删除文件夹（递归）：body = { folder } */
treeRouter.delete('/novels/:id/folders', async (req, res) => {
  const novelId = Number(req.params.id);
  const folder = String(req.body?.folder ?? '').trim();
  if (!folder) {
    res.status(400).json({ error: 'folder 不能为空' });
    return;
  }
  try {
    await deleteFolder(novelId, folder);
    void snapshotNow(novelId);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '删除失败' });
  }
});

/**
 * 移动章节到目标文件夹（可选插入位 beforeId）：
 * body = { novelId, chapterId, folder, beforeId }
 */
treeRouter.post('/chapters/move', (req, res) => {
  const novelId = Number(req.body?.novelId);
  const chapterId = Number(req.body?.chapterId);
  const folder = String(req.body?.folder ?? '').trim();
  const beforeId =
    req.body?.beforeId !== undefined && req.body?.beforeId !== null
      ? Number(req.body.beforeId)
      : undefined;
  if (!Number.isInteger(novelId) || !Number.isInteger(chapterId)) {
    res.status(400).json({ error: 'novelId/chapterId 必须为整数' });
    return;
  }
  try {
    const chapter = moveChapter(novelId, chapterId, folder, beforeId);
    void snapshotNow(novelId);
    res.json(chapter);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '移动失败' });
  }
});
