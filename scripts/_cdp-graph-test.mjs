// 临时 CDP：走第 5 组「图板交互」用例。
// 种子：沈星15(main)/林晚16(main)/老周17/阿水18，4 条边。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9335;
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
const nodeCount = (ws) => evaluate(ws, `document.querySelectorAll('#graph-panel g.graph-node').length`);
const edgeCount = (ws) => evaluate(ws, `document.querySelectorAll('#graph-panel g.graph-edge').length`);
const nodeNames = (ws) => evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-node-text')].map(t => t.textContent)`);
const edgeLabels = (ws) => evaluate(ws, `[...document.querySelectorAll('#graph-panel .graph-edge-label')].map(t => t.textContent)`);
const listNames = (ws) => evaluate(ws, `[...document.querySelectorAll('#sidebar-body .view-item-title')].map(t => t.textContent)`);
const click = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.click(); return 'ok'; })()`);
const ptrDownAt = (ws, js, x, y) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ${x}, clientY: ${y} })); return 'ok'; })()`);
const ptrMove = (ws, x, y) => evaluate(ws, `document.querySelector('#graph-panel svg').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ${x}, clientY: ${y} })); 'ok'`);
const ptrUp = (ws) => evaluate(ws, `document.querySelector('#graph-panel svg').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); 'ok'`);
const circleCx = (ws, id) => evaluate(ws, `Number(document.querySelector('#graph-panel g[data-node-id="${id}"] circle').getAttribute('cx')).toFixed(1)`);
const xform = (ws) => evaluate(ws, `document.querySelector('#graph-panel svg > g').getAttribute('transform')`);

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
console.log('初始 节点:', await nodeCount(ws), '边:', await edgeCount(ws));

// ---- 5.1 拖动节点 阿水(18) ----
console.log('\n=== 5.1 拖动阿水 ===');
const cx0 = Number(await circleCx(ws, '18'));
console.log('拖前 cx=', cx0);
await ptrDownAt(ws, `document.querySelector('#graph-panel g[data-node-id="18"] circle')`, 200, 200);
await sleep(100);
await ptrMove(ws, 260, 200); // delta +60
await sleep(100);
await ptrUp(ws);
await sleep(200);
const cx1 = Number(await circleCx(ws, '18'));
console.log('拖后 cx=', cx1, '| 位移=', (cx1 - cx0).toFixed(1), '(应>0)');

// ---- 5.2 滚轮缩放 ----
console.log('\n=== 5.2 滚轮缩放 ===');
const t0 = await xform(ws);
await evaluate(ws, `document.querySelector('#graph-panel svg').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))`);
await sleep(100);
await evaluate(ws, `document.querySelector('#graph-panel svg').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))`);
await sleep(100);
const t1 = await xform(ws);
console.log('缩放前:', t0);
console.log('缩放后:', t1, '| scale 变了?', !t0.includes(t1.split('scale(')[1]?.split(')')[0] ?? ''));

// ---- 5.3 空白处拖拽平移 ----
console.log('\n=== 5.3 空白处平移 ===');
const t2 = await xform(ws);
await ptrDownAt(ws, `document.querySelector('#graph-panel svg')`, 100, 100);
await sleep(100);
await ptrMove(ws, 160, 130); // delta +60,+30
await sleep(100);
await ptrUp(ws);
await sleep(200);
const t3 = await xform(ws);
console.log('平移前:', t2);
console.log('平移后:', t3, '| translate 变了?', t2 !== t3);

// ---- 5.4 点林晚(16) 再点老周(17) ----
console.log('\n=== 5.4 点 林晚→老周 ===');
console.log(await ptrDownAt(ws, `document.querySelector('#graph-panel g[data-node-id="16"] circle')`, 0, 0));
await sleep(400);
console.log('选中节点名:', await evaluate(ws, `document.querySelector('#graph-panel g.graph-node.selected .graph-node-text')?.textContent ?? '(无)'`), '(应 林晚)');
console.log('保存修改?', await evaluate(ws, `[...document.querySelectorAll('.view-form-row button')].some(b => b.textContent === '保存修改')`));
console.log(await ptrDownAt(ws, `document.querySelector('#graph-panel g[data-node-id="17"] circle')`, 0, 0));
await sleep(400);
console.log('选中节点名:', await evaluate(ws, `document.querySelector('#graph-panel g.graph-node.selected .graph-node-text')?.textContent ?? '(无)'`), '(应 老周)');
console.log('选中节点数:', await evaluate(ws, `document.querySelectorAll('#graph-panel g.graph-node.selected').length`), '(应1)');

// ---- 5.5 只看主要 ----
console.log('\n=== 5.5 打开「只看主要」 ===');
console.log(await click(ws, `document.querySelector('#sidebar-body .graph-toggle input')`));
await sleep(700);
console.log('图上节点:', await nodeNames(ws), '(应 沈星/林晚)');
console.log('图上边:', await edgeLabels(ws), '(应 熟客)');
console.log('列表:', await listNames(ws), '(应 沈星★/林晚★)');
console.log(await ptrDownAt(ws, `document.querySelector('#graph-panel g[data-node-id="16"] circle')`, 0, 0));
await sleep(300);
console.log('仅主要时选中:', await evaluate(ws, `document.querySelector('#graph-panel g.graph-node.selected .graph-node-text')?.textContent ?? '(无)'`), '(应 林晚)');

// ---- 5.6 关闭只看主要 ----
console.log('\n=== 5.6 关闭「只看主要」 ===');
console.log(await click(ws, `document.querySelector('#sidebar-body .graph-toggle input')`));
await sleep(700);
console.log('节点数:', await nodeCount(ws), '(应4) | 边数:', await edgeCount(ws), '(应4)');
console.log('之前选中仍选中?', await evaluate(ws, `document.querySelector('#graph-panel g.graph-node.selected .graph-node-text')?.textContent ?? '(无)'`), '(应 林晚)');

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.promises.rm(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
