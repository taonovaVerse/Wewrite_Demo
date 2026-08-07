// 临时 CDP：走第 4 组「连线模式（图上直接连）」用例。
// 种子：沈星15/林晚16/老周17/阿水18，4 条边。
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
const edgeCount = (ws) => evaluate(ws, `document.querySelectorAll('#graph-panel g.graph-edge').length`);
const edgeLabels = (ws) => evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-edge-label')].map(t => t.textContent)`);
const click = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.click(); return 'ok'; })()`);
const setVal = (ws, id, v) => evaluate(ws, `document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}`);
const ptrDown = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 })); return 'ok'; })()`);
const btnPrimary = (ws) => evaluate(ws, `document.querySelector('.graph-toolbar .btn-primary')?.textContent ?? '(无)'`);
const linkHint = (ws) => evaluate(ws, `[...document.querySelectorAll('#sidebar-body .view-hint')].map(h => h.textContent).join('|')`);

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
  const title = await evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);
  if (title === '资源管理器') break;
  await sleep(300);
}
await click(ws, `document.querySelector('#activitybar [data-view="characters"]')`);
await sleep(1000);
console.log('初始边数:', await edgeCount(ws));

// ---- 4.1 点「连线」 ----
console.log('\n=== 4.1 点「连线」 ===');
console.log(await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '连线')`));
await sleep(300);
console.log('primary 按钮:', await btnPrimary(ws), '(应 连线)');
console.log('侧边栏提示:', await linkHint(ws));

// ---- 4.2 点林晚(16) 再点阿水(18) ----
console.log('\n=== 4.2 林晚→阿水 ===');
console.log(await ptrDown(ws, `document.querySelector('#graph-panel g.graph-node[data-node-id="16"]')`));
await sleep(250);
console.log(await ptrDown(ws, `document.querySelector('#graph-panel g.graph-node[data-node-id="18"]')`));
await sleep(500);
console.log('A/B 预填:', await evaluate(ws, `document.getElementById('rel-rel-a')?.value + ' / ' + document.getElementById('rel-rel-b')?.value`), '(应 16 / 18)');
console.log('连线模式退出? primary=', await btnPrimary(ws), '(应 无)');

// ---- 4.3 填同事 保存 ----
console.log('\n=== 4.3 填「同事」保存 ===');
await setVal(ws, 'rel-rel-label', '同事');
console.log(await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '添加关系')`));
await sleep(800);
console.log('边数:', await edgeCount(ws), '(应5) | 标签:', (await edgeLabels(ws)).join(','));

// ---- 4.4 再进连线 连同人 ----
console.log('\n=== 4.4 连线模式点同一个人 ===');
console.log(await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '连线')`));
await sleep(300);
console.log(await ptrDown(ws, `document.querySelector('#graph-panel g.graph-node[data-node-id="16"]')`));
await sleep(200);
console.log(await ptrDown(ws, `document.querySelector('#graph-panel g.graph-node[data-node-id="16"]')`));
await sleep(400);
console.log('仍在连线模式? primary=', await btnPrimary(ws), '(应 连线)');
console.log('无表单弹出?', await evaluate(ws, `document.getElementById('rel-rel-label') === null`));

// ---- 4.5 Esc 退出 ----
console.log('\n=== 4.5 Esc 退出连线模式 ===');
await evaluate(ws, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await sleep(300);
console.log('primary=', await btnPrimary(ws), '(应 无) | 提示:', await linkHint(ws), '(应空)');

// ---- 4.6 再点「连线」取消 ----
console.log('\n=== 4.6 再点「连线」取消 ===');
console.log(await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '连线')`));
await sleep(200);
console.log('进模式 primary=', await btnPrimary(ws));
console.log(await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '连线')`));
await sleep(200);
console.log('退出 primary=', await btnPrimary(ws), '(应 无)');

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.promises.rm(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
