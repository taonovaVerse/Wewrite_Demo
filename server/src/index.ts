import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rebuildDetailBankFts } from './db.js';
import { migrateAllNovels, createChapterFile, writeChapter } from './fs/novelFs.js';
import { migrateAllDocs, syncAllBankMirrors, createDoc, writeDoc } from './fs/docFs.js';
import { migrateNovelRegistry, createInternalNovel, listNovels } from './fs/registry.js';
import { novelsRouter } from './routes/novels.js';
import { chaptersRouter } from './routes/chapters.js';
import { aiRouter } from './routes/ai.js';
import { detailBankRouter } from './routes/detailBank.js';
import { slsRouter } from './routes/sls.js';
import { treeRouter } from './routes/tree.js';
import { manageRouter } from './routes/manage.js';
import { docsRouter } from './routes/docs.js';
import { versioningRouter } from './routes/versioning.js';
import { registerShutdownFlush } from './fs/versioning.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(): { port?: number } {
  const argv = process.argv.slice(2);
  const out: { port?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      out.port = Number(argv[i + 1]);
      i++;
    }
  }
  return out;
}

const args = parseArgs();
const PORT = args.port ?? Number(process.env.PORT ?? 4000);

/** 磁盘注册表为空时种一部示例小说（正文沿用老 seedIfEmpty 的文案） */
function seedNovelsIfEmpty(): void {
  if (listNovels().length > 0) return;
  const novel = createInternalNovel('示例小说：雨夜便利店');
  const sample = `雨下到后半夜，便利店的灯还亮着。

玻璃门开合的瞬间，冷风裹着雨腥气灌进来，货架最外面那排关东煮的蒸汽被吹得歪了一下。收银台后的男生抬起头，手里的《五年高考三年模拟》压着一支笔帽咬出牙印的圆珠笔。

她收了伞，伞尖在门口那块防滑垫上顿了顿，水顺着伞骨滴成一条线。

“一份萝卜，一份海带结。”她说。

男生低头去揭锅盖，蒸汽扑上他的脸。塑料碗递过去的时候，他多看了一眼——她右手的指甲剪得很短，虎口有茧，像是常年握什么东西的人。`;
  const chapter = createChapterFile(novel.id, '第一章 雨夜', '');
  writeChapter({ ...chapter, content: sample });
  const style = createDoc(novel.id, 'style');
  writeDoc(style, { fields: { voice: '冷峻克制，白描为主，细节走具体物件与动作，避免抒情' } });

  // 示例人物与关系：贴合第一章（收银台复读男生 / 买关东煮的她），切到人物卡即可看到关系图
  const seedChars = [
    {
      name: '沈星', profile: '便利店的晚班店员，复读高三学生', speaking_style: '话少，答话简短', status: '深夜值晚班',
    },
    {
      name: '林晚', profile: '夜归的常客，来买关东煮', speaking_style: '语气平淡，爱点萝卜和海带结', status: '深夜路过',
    },
    {
      name: '老周', profile: '出租车司机，每天收工前买包烟', speaking_style: '嗓门大，爱闲聊', status: '刚收车',
    },
    {
      name: '阿水', profile: '隔壁烧烤摊老板，深夜来补货', speaking_style: '笑呵呵，叫沈星「小沈」', status: '收摊路过',
    },
  ];
  const charDocs = seedChars.map((c) => {
    const doc = createDoc(novel.id, 'characters', c.name);
    const updated = writeDoc(doc, {
      fields: {
        profile: c.profile,
        speaking_style: c.speaking_style,
        status: c.status,
        main: c.name === '沈星' || c.name === '林晚' ? '1' : '',
      },
    });
    return updated;
  });
  const [shen, lin, lao, a] = charDocs;
  const relDoc = createDoc(novel.id, 'relations');
  const edges = [
    { a: shen.id, b: lin.id, label: '熟客', note: '每晚都来' },
    { a: shen.id, b: lao.id, label: '常客', note: '买烟闲聊' },
    { a: shen.id, b: a.id, label: '邻居', note: '补货顺道' },
    { a: lin.id, b: lao.id, label: '打照面', note: '都在深夜出现' },
  ];
  writeDoc(relDoc, { fields: { edges: JSON.stringify(edges) } });
}

migrateNovelRegistry(); // novels 表 → 每部小说 .wewrite/novel.json + .registry.json
migrateAllNovels(); // 目录已由注册表迁移创建 → no-op
migrateAllDocs();
seedNovelsIfEmpty();
syncAllBankMirrors(); // 重灌 detail_bank 镜像（detail_bank 已去掉 novels 外键，外部小说也能写入）
rebuildDetailBankFts();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/novels', novelsRouter);
app.use('/api/novels', versioningRouter);
app.use('/api/chapters', chaptersRouter);
app.use('/api/ai', aiRouter);
app.use('/api/detail-bank', detailBankRouter);
app.use('/api/sls', slsRouter);
app.use('/api', treeRouter);
app.use('/api', manageRouter);
app.use('/api/docs', docsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// 生产模式：托管 client 构建产物
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[wewrite] server listening on http://localhost:${PORT}`);
});

// 收到终止信号时尽力提交待定快照，避免关服前 1.5s 内的改动丢失
registerShutdownFlush();
