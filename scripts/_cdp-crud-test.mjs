// 临时 CDP：走第 2 组「人物增删改」用例。
// 种子库已有 沈星/林晚/老周/阿水。本脚本会新增/删除测试人物，并改林晚 main。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9338;
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
const names = (ws) => evaluate(ws, `[...document.querySelectorAll('#sidebar-body .view-item-title')].map(x => x.textContent.replace(/\\s*★.*$/, ''))`);
const nodeCount = (ws) => evaluate(ws, `document.querySelectorAll('#graph-panel [data-node-id]').length`);
const click = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.click(); return 'ok'; })()`);

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.javascriptDialogOpening') {
    void cdp(ws, 'Page.handleJavaScriptDialog', { accept: true });
    return;
  }
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
};
await cdp(ws, 'Page.enable');

for (let i = 0; i < 20; i++) {
  const title = await evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);
  if (title === '资源管理器') break;
  await sleep(300);
}
// 进人物卡
await click(ws, `document.querySelector('#activitybar [data-view="characters"]')`);
await sleep(1000);
console.log('=== 初始状态 ===');
console.log('节点数:', await nodeCount(ws), '| 人物:', (await names(ws)).join(' / '));

// ---- 2.1 新建人物（只填姓名）----
console.log('\n=== 2.1 新建人物（只填姓名）===');
console.log(await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '＋人物')`));
await sleep(300);
await evaluate(ws, `document.getElementById('rel-char-name').value = '小雯'`);
await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '添加人物')`);
await sleep(800);
console.log('节点数:', await nodeCount(ws), '| 人物:', (await names(ws)).join(' / '));
const xwMain = await evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-node')].some(g => g.querySelector('.graph-node-text')?.textContent === '小雯' && !g.classList.contains('main'))`);
console.log('小雯为普通节点(非 main)?', xwMain);

// ---- 2.2 再建两个 ----
console.log('\n=== 2.2 再建 陈默/老张 ===');
await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '＋人物')`);
await sleep(200);
await evaluate(ws, `document.getElementById('rel-char-name').value = '陈默'`);
await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '添加人物')`);
await sleep(600);
await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '＋人物')`);
await sleep(200);
await evaluate(ws, `document.getElementById('rel-char-name').value = '老张'`);
await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '添加人物')`);
await sleep(800);
console.log('节点数:', await nodeCount(ws), '(应 7)', '| 人物:', (await names(ws)).join(' / '));

// ---- 2.3 点列表行 → 选中 + 编辑表单 ----
console.log('\n=== 2.3 点列表「林晚」行 ===');
console.log(await click(ws, `[...document.querySelectorAll('#sidebar-body .view-item')].find(r => r.textContent.includes('林晚'))`));
await sleep(500);
console.log('编辑按钮?', await evaluate(ws, `[...document.querySelectorAll('.view-form-row button')].some(b => b.textContent === '保存修改')`));
console.log('选中节点数:', await evaluate(ws, `document.querySelectorAll('#graph-panel .graph-node.selected').length`));
console.log('选中节点名:', await evaluate(ws, `document.querySelector('#graph-panel .graph-node.selected .graph-node-text')?.textContent ?? '(无)'`));

// ---- 2.4 编辑林晚：改 profile + 勾主要 保存 ----
console.log('\n=== 2.4 林晚 改身份 + 勾主要 ===');
await evaluate(ws, `document.getElementById('rel-char-profile').value = '深夜便利店店员'`);
await evaluate(ws, `document.getElementById('rel-char-main').checked = true`);
await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '保存修改')`);
await sleep(800);
console.log('林晚 main?', await evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-node')].some(g => g.querySelector('.graph-node-text')?.textContent === '林晚' && g.classList.contains('main'))`));
console.log('列表林晚行含★?', await evaluate(ws, `[...document.querySelectorAll('#sidebar-body .view-item-title')].some(t => t.textContent.includes('林晚') && t.textContent.includes('★'))`));

// ---- 2.5 陈默 勾主要 ----
console.log('\n=== 2.5 陈默 勾主要 ===');
await click(ws, `[...document.querySelectorAll('#sidebar-body .view-item')].find(r => r.textContent.includes('陈默'))`);
await sleep(400);
await evaluate(ws, `document.getElementById('rel-char-main').checked = true`);
await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '保存修改')`);
await sleep(800);
console.log('main 节点数:', await evaluate(ws, `document.querySelectorAll('#graph-panel .graph-node.main').length`), '(应 3)');
console.log('陈默 main?', await evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-node')].some(g => g.querySelector('.graph-node-text')?.textContent === '陈默' && g.classList.contains('main'))`));

// ---- 2.6 取消林晚主要 ----
console.log('\n=== 2.6 取消林晚主要 ===');
await click(ws, `[...document.querySelectorAll('#sidebar-body .view-item')].find(r => r.textContent.includes('林晚'))`);
await sleep(400);
await evaluate(ws, `document.getElementById('rel-char-main').checked = false`);
await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '保存修改')`);
await sleep(800);
console.log('林晚 main?', await evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-node')].some(g => g.querySelector('.graph-node-text')?.textContent === '林晚' && g.classList.contains('main'))`), '(应 false)');
console.log('列表林晚行含★?', await evaluate(ws, `[...document.querySelectorAll('#sidebar-body .view-item-title')].some(t => t.textContent.includes('林晚') && t.textContent.includes('★'))`), '(应 false)');

// ---- 2.7 删除陈默 ----
console.log('\n=== 2.7 删除陈默 ===');
const delRow = await evaluate(ws, `(() => {
  const rows = [...document.querySelectorAll('#sidebar-body .view-item')];
  const row = rows.find(r => r.textContent.includes('陈默'));
  if (!row) return 'NOT_FOUND';
  row.querySelector('.view-item-actions button')?.click();
  return 'ok';
})()`);
console.log('点删除:', delRow);
await sleep(500);
// confirmDelete 是原生 confirm？需要处理
const confirmResult = await evaluate(ws, `typeof confirm === 'function' ? (window.__confirmCalls = (window.__confirmCalls||0)+1, true) : 'no-confirm'`);
console.log('confirm 存在:', confirmResult);
await sleep(500);
console.log('节点数:', await nodeCount(ws), '| 人物:', (await names(ws)).join(' / '));

// ---- 2.8 姓名留空点添加 ----
console.log('\n=== 2.8 姓名留空点添加 ===');
await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '＋人物')`);
await sleep(300);
await evaluate(ws, `document.getElementById('rel-char-name').value = ''`);
const saveR = await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '添加人物')`);
await sleep(600);
console.log('点添加返回:', saveR);
console.log('表单仍在?', await evaluate(ws, `document.getElementById('rel-char-name') !== null`));
console.log('节点数不变?', await nodeCount(ws));

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
