import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedIfEmpty } from './db.js';
import { novelsRouter } from './routes/novels.js';
import { chaptersRouter } from './routes/chapters.js';
import { aiRouter } from './routes/ai.js';
import { detailBankRouter } from './routes/detailBank.js';
import { manageRouter } from './routes/manage.js';

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

seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/novels', novelsRouter);
app.use('/api/chapters', chaptersRouter);
app.use('/api/ai', aiRouter);
app.use('/api/detail-bank', detailBankRouter);
app.use('/api', manageRouter);

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
