// Phase 4 Git 版本管理 e2e 验证（Node fetch，Windows curl 是 GBK 必须用 Node）
// 用法：node scripts/verify-versioning.mjs [--port 4019]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const pi = process.argv.indexOf('--port');
const portArg = Number(pi >= 0 ? process.argv[pi + 1] : process.env.VERIFY_PORT ?? 4019);
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wewrite-vfy-'));
  const dataDir = path.join(tmpRoot, 'data');
  const extDir = path.join(tmpRoot, 'ext-novel');
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
    // 种子小说 id=1
    const novels = (await req('GET', '/api/novels')).data;
    assert(Array.isArray(novels) && novels.length >= 1, '种子小说存在');
    const novelId = 1;
    const detail = (await req('GET', `/api/novels/${novelId}`)).data;
    assert(detail.chapters.length >= 1, '种子小说有章节');
    const chId = detail.chapters[0].id;

    // A. 尚未快照：repo 未建，enabled 且空
    let v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.enabled === true && v.versions.length === 0, '初始：未建仓、版本为空');

    // 建素材库文档 → 触发首次快照（结构操作立即 commit，.docs/素材库 应被忽略）
    await req('POST', '/api/docs', { novelId, kind: 'bank', title: '细节素材' });
    await sleep(800);
    v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length === 1, '首次快照（建素材库触发）');
    const c0 = v.versions[0].hash;
    let d = (await req('GET', `/api/novels/${novelId}/versions/${c0}`)).data;
    assert(d.some((f) => f.path === '.gitignore'), '基线包含 .gitignore');
    assert(!d.some((f) => f.path.startsWith('.wewrite/')), '.wewrite/ 未入库');
    assert(!d.some((f) => f.path.startsWith('.docs/素材库/')), '.docs/素材库/ 未入库');

    // B. 改章节 → 1.5s 防抖自动快照
    const content1 = '第一段内容。\n\n第二段内容。\n';
    const content2 = '第一段内容。\n\n第二段内容。\n\n新增段落XYZ。\n';
    await req('PUT', `/api/chapters/${chId}`, { content: content1 });
    await sleep(2600);
    v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length === 2, '编辑章节后防抖快照');
    const c1 = v.versions[0].hash;
    assert(c1 !== c0, '两次 commit 哈希不同');
    d = (await req('GET', `/api/novels/${novelId}/versions/${c1}`)).data;
    const chFile = d.find((f) => f.path.endsWith('.md') && !f.path.startsWith('.docs/'));
    assert(chFile && chFile.added > 0 && chFile.lines.some((l) => l.type === 'add'), '章节 diff 含新增行');

    // C. 再改一次 → 第二次快照（作为回滚目标）
    await req('PUT', `/api/chapters/${chId}`, { content: content2 });
    await sleep(2600);
    v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length === 3, '第二次编辑快照');
    const restoreTarget = v.versions[0].hash;

    // D. 改坏 → 第三次快照
    await req('PUT', `/api/chapters/${chId}`, { content: '坏内容BAD。' });
    await sleep(2600);
    v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length === 4, '改坏后快照');
    const badHash = v.versions[0].hash;

    // E. 回滚到 restoreTarget
    let r = await req('POST', `/api/novels/${novelId}/versions/${restoreTarget}/restore`);
    assert(r.status === 200 && r.data.restored === true, '回滚成功');
    const ch = (await req('GET', `/api/chapters/${chId}`)).data;
    assert(ch.content.includes('新增段落XYZ'), '章节内容已还原');
    v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length === 3 && v.versions[0].hash === restoreTarget, 'HEAD 已回到目标版本');

    // F. 手动快照：先编辑（防抖未到）再立即 POST → 立刻入库且不产生重复 commit
    const content3 = '手动快照测试。\n';
    await req('PUT', `/api/chapters/${chId}`, { content: content3 });
    const mres = (await req('POST', `/api/novels/${novelId}/versions`)).data;
    assert(mres.committed === true, '手动快照立即提交');
    v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length === 4, '手动快照后版本数');
    await sleep(2600);
    v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length === 4, '防抖 timer 已取消（无重复 commit）');

    // G. 建章节 → 结构操作立即快照
    await req('POST', `/api/novels/${novelId}/chapters`, { title: '第二章 测试' });
    await sleep(800);
    v = (await req('GET', `/api/novels/${novelId}/versions`)).data;
    assert(v.versions.length === 5, '新建章节立即快照');

    // H. 外部文件夹已自带 .git → 不接管
    fs.mkdirSync(path.join(extDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(extDir, '第一章.md'), '外部内容。');
    const extMeta = (await req('POST', '/api/novels/open', { path: extDir })).data;
    assert(extMeta.id, '外部文件夹打开成功');
    const ev = (await req('GET', `/api/novels/${extMeta.id}/versions`)).data;
    assert(ev.enabled === false, '外部已有 git → 未启用');
    const m2 = (await req('POST', `/api/novels/${extMeta.id}/versions`)).data;
    assert(m2.committed === false, '未启用的小说快照不提交');
    const rBad = await req('POST', `/api/novels/${extMeta.id}/versions/${'0'.repeat(40)}/restore`);
    assert(rBad.status === 400, '未启用的小说回滚 → 400');

    // I. 无效 hash
    const rBad2 = await req('POST', `/api/novels/${novelId}/versions/not-a-hash/restore`);
    assert(rBad2.status === 400, '非 hex hash → 400');
    const rBad3 = await req('POST', `/api/novels/${novelId}/versions/${'a'.repeat(40)}/restore`);
    assert(rBad3.status === 400, '不存在的 hash → 400');

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
