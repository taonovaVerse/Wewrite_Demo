// 临时 CDP：走第 3 组「关系增删改」用例。
// 种子边：沈星15-林晚16 熟客 / 沈星15-老周17 常客 / 沈星15-阿水18 邻居 / 林晚16-老周17 打照面
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9337;
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
const edgeCount = (ws) => evaluate(ws, `document.querySelectorAll('#graph-panel g.graph-edge').length`);
const edgeLabels = (ws) => evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-edge-label')].map(t => t.textContent)`);
const click = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.click(); return 'ok'; })()`);
const setVal = (ws, id, v) => evaluate(ws, `document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}`);
const ptrDown = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 })); return 'ok'; })()`);

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
console.log('=== 初始 ===');
console.log('边数:', await edgeCount(ws), '| 标签:', (await edgeLabels(ws)).join(','));
console.log('人物:', (await names(ws)).join(' / '));

// ---- 3.1 建 老周—阿水 酒友 ----
console.log('\n=== 3.1 老周—阿水（酒友）===');
console.log(await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '＋关系')`));
await sleep(300);
await setVal(ws, 'rel-rel-a', '17');
await setVal(ws, 'rel-rel-b', '18');
await setVal(ws, 'rel-rel-label', '酒友');
await setVal(ws, 'rel-rel-note', '收工后一起喝');
console.log(await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '添加关系')`));
await sleep(800);
console.log('边数:', await edgeCount(ws), '(应5) | 标签:', (await edgeLabels(ws)).join(','));

// ---- 3.2 建 林晚—阿水 打过照面 ----
console.log('\n=== 3.2 林晚—阿水（打过照面）===');
console.log(await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '＋关系')`));
await sleep(300);
await setVal(ws, 'rel-rel-a', '16');
await setVal(ws, 'rel-rel-b', '18');
await setVal(ws, 'rel-rel-label', '打过照面');
console.log(await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '添加关系')`));
await sleep(800);
console.log('边数:', await edgeCount(ws), '(应6) | 标签:', (await edgeLabels(ws)).join(','));

// ---- 3.3 点「酒友」连线 ----
console.log('\n=== 3.3 点「酒友」连线 ===');
console.log(await ptrDown(ws, `[...document.querySelectorAll('#graph-panel g.graph-edge')].find(g => g.querySelector('.graph-edge-label')?.textContent === '酒友')?.querySelector('.graph-edge-hit')`));
await sleep(500);
console.log('选中边数:', await evaluate(ws, `document.querySelectorAll('#graph-panel g.graph-edge.selected').length`), '(应1)');
console.log('选中边标签:', await evaluate(ws, `document.querySelector('#graph-panel g.graph-edge.selected .graph-edge-label')?.textContent ?? '(无)'`));
console.log('编辑按钮?', await evaluate(ws, `[...document.querySelectorAll('.view-form-row button')].some(b => b.textContent === '保存关系')`));
console.log('A/B 预填:', await evaluate(ws, `document.getElementById('rel-rel-a').value + ' / ' + document.getElementById('rel-rel-b').value`), '(应 17 / 18)');

// ---- 3.4 改关系=牌友 ----
console.log('\n=== 3.4 改关系=牌友 ===');
await setVal(ws, 'rel-rel-label', '牌友');
console.log(await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '保存关系')`));
await sleep(800);
console.log('标签:', (await edgeLabels(ws)).join(','));
console.log('有牌友?', await evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-edge-label')].some(t => t.textContent === '牌友')`), '| 有酒友?', await evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-edge-label')].some(t => t.textContent === '酒友')`));

// ---- 3.5 再选该关系 点删除 ----
console.log('\n=== 3.5 删除「牌友」关系 ===');
console.log(await ptrDown(ws, `[...document.querySelectorAll('#graph-panel g.graph-edge')].find(g => g.querySelector('.graph-edge-label')?.textContent === '牌友')?.querySelector('.graph-edge-hit')`));
await sleep(400);
console.log(await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '删除')`));
await sleep(800);
console.log('边数:', await edgeCount(ws), '(应5) | 标签:', (await edgeLabels(ws)).join(','));

// ---- 3.6 建关系后取消 ----
console.log('\n=== 3.6 建「林晚—阿水」后取消 ===');
console.log(await click(ws, `[...document.querySelectorAll('.graph-toolbar button')].find(b => b.textContent === '＋关系')`));
await sleep(300);
await setVal(ws, 'rel-rel-a', '16');
await setVal(ws, 'rel-rel-b', '18');
await setVal(ws, 'rel-rel-label', '重复测试');
console.log(await click(ws, `[...document.querySelectorAll('.view-form-row button')].find(b => b.textContent === '取消')`));
await sleep(400);
console.log('表单收起?', await evaluate(ws, `document.getElementById('rel-rel-label') === null`));
console.log('边数:', await edgeCount(ws), '(应5 不变) | 标签:', (await edgeLabels(ws)).join(','));

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.promises.rm(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
