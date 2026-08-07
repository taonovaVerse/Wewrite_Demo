// 临时 CDP：覆盖 7.5（无「人物关系」入口）/ 8.4（边引用不存在人物）/ 8.3（坏 JSON edges）/ 9.5（命令面板）。
// 用 API 临时改 relations 文档再恢复，验证图板边界处理。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
const API = 'http://127.0.0.1:4000/api';

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
const nodeCount = (ws) => evaluate(ws, `document.querySelectorAll('#graph-panel g.graph-node').length`);
const edgeCount = (ws) => evaluate(ws, `document.querySelectorAll('#graph-panel g.graph-edge').length`);
const nodeNames = (ws) => evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-node-text')].map(t => t.textContent)`);
const edgeLabels = (ws) => evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-edge-label')].map(t => t.textContent)`);
const listNames = (ws) => evaluate(ws, `[...document.querySelectorAll('#sidebar-body .view-item-title')].map(t => t.textContent)`);
const click = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.click(); return 'ok'; })()`);

async function apiPutEdges(value) {
  const [novel] = await (await fetch(`${API}/novels`)).json();
  const docs = await (await fetch(`${API}/docs?novelId=${novel.id}&kind=relations`)).json();
  const rel = docs[0];
  const r = await fetch(`${API}/docs/relations/${rel.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId: novel.id, fields: { edges: typeof value === 'string' ? value : JSON.stringify(value) } }),
  });
  if (!r.ok) throw new Error(`PUT edges: ${r.status}`);
}
const seedEdges = [
  { a: 15, b: 16, label: '熟客', note: '每晚都来' },
  { a: 15, b: 17, label: '常客', note: '买烟闲聊' },
  { a: 15, b: 18, label: '邻居', note: '补货顺道' },
  { a: 16, b: 17, label: '打照面', note: '都在深夜出现' },
];
async function reloadAndWait(ws) {
  await evaluate(ws, 'location.reload()');
  for (let i = 0; i < 30; i++) {
    const t = await evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);
    if (t === '资源管理器') return;
    await sleep(300);
  }
  throw new Error('reload wait timeout');
}
const charView = async (ws) => {
  await click(ws, `document.querySelector('#activitybar [data-view="characters"]')`);
  await sleep(900);
};

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

// ---- 7.5 资源管理器无「人物关系」入口 ----
console.log('=== 7.5 资源管理器无「人物关系」入口 ===');
const folderNames = await evaluate(ws, `[...document.querySelectorAll('.tree-folder-name')].map(n => n.textContent)`);
console.log('文档树文件夹:', folderNames.join(' / '));
console.log('含「人物关系」?', folderNames.includes('人物关系'), '(应 false)');

// ---- 8.4 边引用不存在人物(999) ----
console.log('\n=== 8.4 边引用不存在人物 ===');
await apiPutEdges([...seedEdges, { a: 15, b: 999, label: '幽灵边' }]);
await reloadAndWait(ws);
await charView(ws);
console.log('节点:', (await nodeNames(ws)).join('/'), '(应 4) | 边:', (await edgeLabels(ws)).join(','), '(应 熟客,常客,邻居,打照面，幽灵被过滤)');

// ---- 8.3 坏 JSON edges ----
console.log('\n=== 8.3 坏 JSON edges ===');
await apiPutEdges('{bad json');
await reloadAndWait(ws);
await charView(ws);
console.log('不白屏? graph-panel 存在:', await evaluate(ws, `document.getElementById('graph-panel') !== null`), '(应 true)');
console.log('节点:', await nodeCount(ws), '(应 4) | 边:', await edgeCount(ws), '(应 0)');
console.log('列表人物:', (await listNames(ws)).join('/'), '(应 4)');

// ---- 恢复种子 ----
await apiPutEdges(seedEdges);
await reloadAndWait(ws);
await charView(ws);
console.log('\n恢复种子后 节点:', await nodeCount(ws), '边:', await edgeCount(ws), '(应 4/4)');

// ---- 9.5 命令面板 ----
console.log('\n=== 9.5 命令面板 ===');
await evaluate(ws, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))`);
await sleep(400);
const total = await evaluate(ws, `document.querySelectorAll('#palette-list .overlay-item').length`);
const switchCmds = await evaluate(ws, `[...document.querySelectorAll('#palette-list .overlay-item')].filter(r => r.textContent.startsWith('切换到')).length`);
console.log('命令总数:', total, '| 「切换到」命令数:', switchCmds, '(应 8)');

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.promises.rm(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
