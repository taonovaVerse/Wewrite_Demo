import { Router } from 'express';
import { createChapterFile, listNovelTree } from '../fs/novelFs.js';
import { listNovelDocs } from '../fs/docFs.js';
import {
  listNovels,
  novelById,
  createInternalNovel,
  openExternalNovel,
  renameNovel,
  deleteNovel,
  touchNovel,
  type NovelMeta,
} from '../fs/registry.js';

export const novelsRouter = Router();

function shape(n: NovelMeta) {
  return {
    id: n.id,
    title: n.title,
    folder: n.folder,
    created_at: n.created_at,
    updated_at: n.updated_at,
    external: n.external,
  };
}

novelsRouter.get('/', (_req, res) => {
  res.json(listNovels().map(shape));
});

novelsRouter.post('/', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) {
    res.status(400).json({ error: 'title 不能为空' });
    return;
  }
  res.status(201).json(shape(createInternalNovel(title)));
});

// 打开外部文件夹为小说（幂等：同路径/已有 novel.json 则复用 id）
novelsRouter.post('/open', (req, res) => {
  const rawPath = String(req.body?.path ?? '');
  if (!rawPath) {
    res.status(400).json({ error: 'path 不能为空' });
    return;
  }
  try {
    const { meta, created } = openExternalNovel(rawPath);
    res.status(created ? 201 : 200).json(shape(meta));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '打开失败' });
  }
});

novelsRouter.get('/:id', (req, res) => {
  const novel = novelById(Number(req.params.id));
  if (!novel) {
    res.status(404).json({ error: '小说不存在' });
    return;
  }
  // tree = 资源管理器文件树；chapters = 平铺+深度优先顺序（tabs/quickOpenChapter 继续按 id 用）；docs = 世界文档列表
  const { tree, chapters } = listNovelTree(novel.id);
  const docs = listNovelDocs(novel.id);
  res.json({ ...shape(novel), tree, chapters, docs });
});

novelsRouter.put('/:id', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) {
    res.status(400).json({ error: 'title 不能为空' });
    return;
  }
  try {
    res.json(shape(renameNovel(Number(req.params.id), title)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '重命名失败' });
  }
});

novelsRouter.delete('/:id', async (req, res) => {
  try {
    await deleteNovel(Number(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '删除失败' });
    return;
  }
  res.status(204).end();
});

novelsRouter.post('/:id/chapters', (req, res) => {
  const novelId = Number(req.params.id);
  if (!novelById(novelId)) {
    res.status(404).json({ error: '小说不存在' });
    return;
  }
  const title = String(req.body?.title ?? '未命名章节');
  const folder = String(req.body?.folder ?? '').trim();
  const chapter = createChapterFile(novelId, title, folder);
  touchNovel(novelId);
  res.status(201).json(chapter);
});
