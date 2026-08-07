// 临时 CDP：验证左右分栏——人物卡视图图板在右侧与编辑器同屏共存；切走视图图板隐藏。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
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
const graphHidden = (ws) => evaluate(ws, `document.getElementById('graph-panel').classList.contains('hidden')`);
const editorHidden = (ws) => evaluate(ws, `document.getElementById('editor-wrap').classList.contains('hidden')`);
const splitExists = (ws) => evaluate(ws, `!!document.getElementById('editor-split')`);
const rect = (ws, id) => evaluate(ws, `(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.x)]; })()`);
const tabCount = (ws) => evaluate(ws, `document.querySelectorAll('#tabs .tab').length`);
const view = (ws) => evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);
const click = (ws, js) => evaluate(ws, `(() => { const e = ${js}; if (!e) return 'NOT_FOUND'; e.click(); return 'ok'; })()`);
const state = async (ws, label) => {
  const gw = await graphHidden(ws);
  const ew = await editorHidden(ws);
  const [split, gwRect, ewRect] = await Promise.all([splitExists(ws), rect(ws, 'graph-panel'), rect(ws, 'editor-wrap')]);
  console.log(`${label} | 视图: ${await view(ws)} | tab: ${await tabCount(ws)} | 图板hidden: ${gw} | editor hidden: ${ew} | split: ${split} | 图板宽/位置: ${gwRect} | 编辑器宽/位置: ${ewRect}`);
  const ok = !ew && gw === (await view(ws) !== '人物卡') && split;
  if (!ok) throw new Error(`断言失败 @ ${label}`);
  return gw;
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

// 0. 初始：explorer 视图，图板隐藏、编辑器可见、分栏容器已建
await state(ws, '0 初始(explorer)');

// 1. 打开章节：编辑器显示章节，图板仍隐藏（视图不是人物卡）
console.log(await click(ws, `document.querySelector('#activitybar [data-view="explorer"]')`));
await sleep(400);
console.log(await click(ws, `document.querySelector('.tree-chapter')`));
await sleep(900);
await state(ws, '1 打开章节(explorer视图)');

// 2. 点人物卡 → 图板右侧显示，编辑器同屏可见
console.log(await click(ws, `document.querySelector('#activitybar [data-view="characters"]')`));
await sleep(900);
await state(ws, '2 点人物卡(有tab)');

// 3. 点章节 tab → 编辑器仍显示，图板仍可见（共存）
console.log(await click(ws, `document.querySelector('#tabs .tab')`));
await sleep(600);
await state(ws, '3 点tab(仍共存)');

// 4. 关闭 tab → 图板保持可见
console.log(await click(ws, `document.querySelector('#tabs .tab-close')`));
await sleep(700);
await state(ws, '4 关tab后');

// 5. 切资源管理器 → 图板隐藏，编辑器占满
console.log(await click(ws, `document.querySelector('#activitybar [data-view="explorer"]')`));
await sleep(700);
await state(ws, '5 切explorer');

// 6. 再切回人物卡（无 tab）→ 图板恢复
console.log(await click(ws, `document.querySelector('#activitybar [data-view="characters"]')`));
await sleep(900);
await state(ws, '6 切回人物卡');

child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.promises.rm(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
