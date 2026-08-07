// 临时 CDP：验证可拖动分隔条——拖图板左边界改变宽度，localStorage 持久化，切视图隐藏。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
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
const mouse = (ws, type, x, y) => cdp(ws, 'Input.dispatchMouseEvent', {
  type, x, y, button: 'left',
  buttons: type === 'mouseMoved' ? 1 : type === 'mousePressed' ? 1 : 0,
  clickCount: type === 'mousePressed' ? 1 : 0,
});
const graphWidth = (ws) => evaluate(ws, `Math.round(document.getElementById('graph-panel').getBoundingClientRect().width)`);
const resizerHidden = (ws) => evaluate(ws, `document.getElementById('graph-resizer').classList.contains('hidden')`);
const resizerBox = (ws) => evaluate(ws, `(() => { const r = document.getElementById('graph-resizer').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
const savedW = (ws) => evaluate(ws, `localStorage.getItem('wewrite.graphWidth')`);
const view = (ws) => evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);

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

// 1. 进人物卡：分隔条出现，图板默认宽 340
await click(ws, `document.querySelector('#activitybar [data-view="characters"]')`);
await sleep(900);
console.log('进人物卡 | 图板宽:', await graphWidth(ws), '| 分隔条hidden:', await resizerHidden(ws), '(应 false, 340)');

// 2. 拖分隔条向左 80px → 图板变宽
const [rx, ry] = await resizerBox(ws);
console.log('分隔条中心:', rx, ry);
await mouse(ws, 'mousePressed', rx, ry);
await mouse(ws, 'mouseMoved', rx - 80, ry);
await mouse(ws, 'mouseReleased', rx - 80, ry);
await sleep(300);
const w1 = await graphWidth(ws);
console.log('拖动后 图板宽:', w1, '(应约', 340 + 80 + ' )', '| localStorage:', await savedW(ws));

// 3. 再往回拖 30px → 变窄
const [rx2] = await resizerBox(ws);
await mouse(ws, 'mousePressed', rx2, ry);
await mouse(ws, 'mouseMoved', rx2 + 30, ry);
await mouse(ws, 'mouseReleased', rx2 + 30, ry);
await sleep(300);
const w2 = await graphWidth(ws);
console.log('再拖窄 图板宽:', w2, '| localStorage:', await savedW(ws));

// 4. 切资源管理器 → 分隔条隐藏
await click(ws, `document.querySelector('#activitybar [data-view="explorer"]')`);
await sleep(700);
console.log('切explorer | 分隔条hidden:', await resizerHidden(ws), '(应 true) | 视图:', await view(ws));

// 5. 切回人物卡 → 图板保持拖后宽度
await click(ws, `document.querySelector('#activitybar [data-view="characters"]')`);
await sleep(900);
console.log('切回人物卡 | 图板宽:', await graphWidth(ws), '(应保持', w2 + ')');

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.promises.rm(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
