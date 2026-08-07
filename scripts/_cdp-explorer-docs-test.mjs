// 临时 CDP：验证资源管理器侧边栏「文档」组已改为「素材库」——标题直达记录行，无中间文件夹层。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9336;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${tmp}`,
  'http://localhost:5173/',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const pages = await r.json();
      const page = pages.find((p) => p.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { }
    await sleep(250);
  }
  throw new Error('CDP endpoint not ready');
}
let msgId = 0;
const pending = new Map();
function cdp(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout ${method}`)); }, 15000);
  });
}
async function evaluate(ws, expr) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`JS error: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)}`);
  return r.result?.value;
}
const click = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.click(); return 'ok'; })()`);

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
};
for (let i = 0; i < 20; i++) {
  const t = await evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);
  if (t === '资源管理器') break;
  await sleep(300);
}
for (let i = 0; i < 30; i++) {
  if (await evaluate(ws, `!!document.querySelector('.tree-novel-title')`)) break;
  await sleep(300);
}
await sleep(500);

// 选中种子小说，让文档区随小说加载
await click(ws, `document.querySelector('.tree-novel')`);
await sleep(700);

const sectionTitles = await evaluate(ws, `[...document.querySelectorAll('.tree-section-title span')].map((e) => e.textContent)`);
console.log('侧边栏分组标题:', JSON.stringify(sectionTitles), '(应含 素材库，不含 文档)');

const folderNames = await evaluate(ws, `[...document.querySelectorAll('.tree-folder-name')].map((e) => e.textContent)`);
console.log('可展开文件夹行:', JSON.stringify(folderNames), '(应为空数组 → 已去掉中间层)');

const hint = await evaluate(ws, `document.querySelector('.tree-section:last-child .view-hint')?.textContent ?? '(有记录行)'`);
console.log('素材库区内容提示:', hint);

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.promises.rm(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
