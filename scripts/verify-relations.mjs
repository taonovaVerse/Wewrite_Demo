// 人物卡关系图 e2e 验证（Node fetch，Windows curl 是 GBK 必须用 Node）
// 覆盖：人物 main 字段读写、relations 单例、edges 存取、章节/文档/版本管理回归
// 用法：node scripts/verify-relations.mjs [--port 4021]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const pi = process.argv.indexOf('--port');
const portArg = Number(pi >= 0 ? process.argv[pi + 1] : process.env.VERIFY_PORT ?? 4021);
const BASE = `http://127.0.0.1:${portArg}`;

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wewrite-rel-'));
  const dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  console.log(`启动 server: --port ${portArg} --data-dir ${dataDir}`);
  const child = spawn('node', ['server/dist/index.js', '--port', String(portArg), '--data-dir', dataDir], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
  child.stderr.on('data', (d) => process.stdout.write(`[srv-err] ${d}`));
  child.on('exit', (code, signal) => console.error(`[srv-exit] code=${code} signal=${signal}`));

  // 等待就绪
  for (let i = 0; i < 60; i++) {
    try {
      const { status } = await req('GET', '/api/health');
      if (status === 200) break;
    } catch {
      /* 未就绪 */
    }
    await sleep(500);
    if (i === 59) throw new Error('server 未在 30s 内就绪');
  }

  try {
    const novelId = 1;
    const detail = (await req('GET', `/api/novels/${novelId}`)).data;
    assert(detail && detail.chapters.length >= 1, '种子小说存在且有章节');
    const chId = detail.chapters[0].id;

    // ---- A. 人物 main 字段 ----
    const c1 = await req('POST', '/api/characters', {
      novelId, name: '林晚', profile: '深夜便利店店员', status: '值班', main: true,
    });
    assert(c1.status === 201 && c1.data.main === true, '建人物 main:true → main 返回 true');
    assert(c1.data.profile === '深夜便利店店员', '建人物返回结构化字段');
    const c2 = await req('POST', '/api/characters', {
      novelId, name: '陈默', main: false,
    });
    assert(c2.status === 201 && c2.data.main === false, '建人物 main:false → main 返回 false');
    const id1 = c1.data.id;
    const id2 = c2.data.id;

    let chars = (await req('GET', `/api/characters?novelId=${novelId}`)).data;
    const byName = Object.fromEntries(chars.map((c) => [c.name, c]));
    assert(byName['林晚']?.main === true && byName['陈默']?.main === false, 'GET 人物列表 main 正确');

    // 改 main:false → 字段应从文件中删除（空串字段被 writeDoc 抹掉）
    await req('PUT', `/api/characters/${id1}`, { main: false });
    chars = (await req('GET', `/api/characters?novelId=${novelId}`)).data;
    assert(chars.find((c) => c.id === id1)?.main === false, '改 main:false → main 返回 false');
    const charDoc = (await req('GET', `/api/docs/characters/${id1}?novelId=${novelId}`)).data;
    const novelFolders = fs.readdirSync(path.join(dataDir, 'novels'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    assert(novelFolders.length >= 1, 'novels 目录有小说文件夹');
    const raw = fs.readFileSync(
      path.join(dataDir, 'novels', novelFolders[0], charDoc.path),
      'utf8',
    );
    assert(!/^\s*main:/m.test(raw), '磁盘 front-matter 无 main 字段（空字段已删除）');

    // 改回 main:true
    await req('PUT', `/api/characters/${id1}`, { main: true });
    chars = (await req('GET', `/api/characters?novelId=${novelId}`)).data;
    assert(chars.find((c) => c.id === id1)?.main === true, '改回 main:true → main 返回 true');

    // ---- B. relations 单例 ----
    const r1 = await req('POST', '/api/docs', { novelId, kind: 'relations' });
    assert(r1.status === 201 && r1.data.kind === 'relations', '建 relations 文档成功');
    const relId = r1.data.id;
    const r2 = await req('POST', '/api/docs', { novelId, kind: 'relations' });
    assert(r2.status === 201 && r2.data.id === relId, '重复 POST relations → 返回同一文档（单例）');
    const relList = (await req('GET', `/api/docs?novelId=${novelId}&kind=relations`)).data;
    assert(relList.length === 1 && relList[0].id === relId, 'GET relations 列表只有一份');

    // ---- C. edges 存取 ----
    const edges = [
      { a: id1, b: id2, label: '夫妻', note: '高中同学' },
    ];
    const saved = await req('PUT', `/api/docs/relations/${relId}`, {
      novelId,
      fields: { edges: JSON.stringify(edges) },
    });
    assert(saved.status === 200, 'PUT edges 保存成功');
    const got = (await req('GET', `/api/docs/relations/${relId}?novelId=${novelId}`)).data;
    const parsed = JSON.parse(String(got.fields.edges ?? '[]'));
    assert(
      parsed.length === 1 && parsed[0].a === id1 && parsed[0].b === id2
        && parsed[0].label === '夫妻' && parsed[0].note === '高中同学',
      'GET 回读 edges 与保存一致',
    );

    // 空 edges → 字段删除
    await req('PUT', `/api/docs/relations/${relId}`, { novelId, fields: { edges: '' } });
    const got2 = (await req('GET', `/api/docs/relations/${relId}?novelId=${novelId}`)).data;
    assert(!('edges' in got2.fields) || got2.fields.edges === '', '清空 edges → 字段被删除');

    // ---- D. 回归：章节 / 文档 / 版本管理 ----
    const ch = (await req('GET', `/api/chapters/${chId}`)).data;
    await req('PUT', `/api/chapters/${chId}`, { content: ch.content + '\n新增回归内容XYZ。\n' });
    await sleep(2600);
    let v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length >= 1, '改章节触发版本快照');

    // 现有 5 类文档仍可用
    const bank = await req('POST', '/api/docs', { novelId, kind: 'bank', title: '素材验证' });
    assert(bank.status === 201, '素材库文档仍可建');
    const world = await req('POST', '/api/world-settings', { novelId, key: '城市', value: '临海' });
    assert(world.status === 201, '世界观仍可建');
    const style = await req('PUT', '/api/style-profile', { novelId, voice: '冷峻短句' });
    assert(style.status === 200 && style.data.voice === '冷峻短句', '文风档案仍可存');

    // 删人物 → 残留边引用不应导致读取/保存崩坏
    await req('DELETE', `/api/characters/${id2}`);
    const relList2 = (await req('GET', `/api/docs?novelId=${novelId}&kind=relations`)).data;
    const edgesStr = String(relList2[0].fields.edges || '[]');
    const parsed2 = JSON.parse(edgesStr);
    assert(Array.isArray(parsed2), '删人物后读回 edges 仍为合法数组');

    console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    console.log('关闭 server…');
    child.kill('SIGTERM');
    const t = setTimeout(() => child.kill('SIGKILL'), 3000);
    await new Promise((resolve) => child.once('exit', resolve));
    clearTimeout(t);
    // 用 fs.promises.rm 清理（fs.rmSync 在 Windows 对特定文件名会 fail-fast 崩溃）
    await fs.promises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
