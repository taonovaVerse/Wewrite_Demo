// 临时 CDP：内联改写（对标 VSCode Rewrite）冒烟。
// 用 Fetch 拦截 /api/ai/assistant（喂假 SSE）与 /api/chapters/:id（吞掉自动保存），
// 避免真实 AI 调用与污染真实库；章节真实内容从运行中的 server 读取（只读）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));

// 读取真实章节（选中源 + 保存回显的完整对象）
const novels = await (await fetch('http://localhost:4000/api/novels')).json();
const novelId = novels[0].id;
const detail = await (await fetch(`http://localhost:4000/api/novels/${novelId}`)).json();
const chapter = detail.chapters[0];
const firstLine = chapter.content.split('\n').find(Boolean) ?? chapter.content.slice(0, 20);

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
// 从 CM 真实状态读取当前主选区 / 文档全文（绕过 DOM 观察，避免 widget 文本干扰）
async function hasSelection(ws) {
  return evaluate(ws, `(() => {
    const view = document.querySelector('.cm-content')?.cmTile?.root?.view;
    return view ? !view.state.selection.main.empty : false;
  })()`);
}
async function docStr(ws) {
  return evaluate(ws, `(() => {
    const view = document.querySelector('.cm-content')?.cmTile?.root?.view;
    return view ? view.state.doc.toString() : '';
  })()`);
}

let results = [];
function check(name, ok, extra = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let assistantHits = [];
let saveHits = 0;
let pageErrors = [];

async function handlePaused(requestId, request) {
  const url = request.url;
  if (url.includes('/api/ai/assistant')) {
    let post = request.postData ?? '';
    if (!post && request.postDataEntries?.length) {
      post = Buffer.from(request.postDataEntries[0].bytes, 'base64').toString('utf8');
    }
    let body = {};
    try { body = JSON.parse(post || '{}'); } catch { }
    const mode = body.mode ?? 'ask';
    assistantHits.push({ mode, originalText: body.rewrite?.originalText ?? null, msgCount: body.messages?.length });
    const tokens = mode === 'rewrite'
      ? ['【改写稿】她把雨伞搁在门边，水珠顺着伞尖滴落。', '便利店暖黄的灯光笼住她的轮廓。']
      : ['（助手回答）作者参考：节奏可以稳住，雨伞这个意象可以留到结尾回收。'];
    const sse = tokens.map((t) => `data: ${JSON.stringify({ type: 'token', text: t })}\n\n`).join('');
    await cdp(ws, 'Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/event-stream' }],
      body: Buffer.from(sse, 'utf8').toString('base64'),
    });
    return;
  }
  if (url.includes('/api/chapters/') && request.method === 'PUT') {
    saveHits++;
    let patch = {};
    try { patch = JSON.parse(request.postData ?? '{}'); } catch { }
    const echo = { ...chapter, content: patch.content ?? chapter.content };
    await cdp(ws, 'Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(echo), 'utf8').toString('base64'),
    });
    return;
  }
  await cdp(ws, 'Fetch.continueRequest', { requestId });
}

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
    return;
  }
  if (m.method === 'Fetch.requestPaused') {
    void handlePaused(m.params.requestId, m.params.request).catch((err) => {
      console.log('intercept error:', err.message);
      void cdp(ws, 'Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => { });
    });
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? '');
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};

await cdp(ws, 'Page.enable');
await cdp(ws, 'Runtime.enable');
await cdp(ws, 'Fetch.enable', {
  patterns: [
    { urlPattern: '*assistant*', requestStage: 'Request' },
    { urlPattern: '*chapters/*', requestStage: 'Request' },
  ],
});

// 等应用加载到资源管理器
for (let i = 0; i < 30; i++) {
  const title = await evaluate(ws, `document.querySelector('#sidebar-header span')?.textContent ?? ''`);
  if (title === '资源管理器') break;
  await sleep(300);
}

// ---- 1. 打开第一章 ----
console.log('\n=== 1. 打开章节 ===');
await evaluate(ws, `(() => { const row = document.querySelector('.tree-chapter'); if (!row) return 'NO_ROW'; row.click(); return 'ok'; })()`);
await sleep(1500);
check('编辑器出现章节内容', await evaluate(ws, `document.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(firstLine)}) ?? false`));

// 辅助：鼠标拖选编辑器某一行（linIdx 按非空行计数，从 0 开始）
// 起始点用 elementFromPoint 校验必须命中 .cm-line，避免落在侧边栏/溢出区触发原生拖放；
// 成功后校验选区非空，失败重试。
async function dragSelect(linIdx = 0) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rect = await evaluate(ws, `(() => {
      const lines = [...document.querySelectorAll('.cm-content .cm-line')].filter(l => l.textContent.trim());
      const line = lines[${linIdx}] ?? lines[0];
      if (!line) return null;
      const r = line.getBoundingClientRect();
      const ed = line.closest('.cm-editor')?.getBoundingClientRect();
      if (!ed) return null;
      const y = r.y + r.height / 2;
      const cands = [Math.max(r.x, ed.x) + 16, ed.x + ed.width / 2];
      let x = null;
      for (const cx of cands) {
        const el = document.elementFromPoint(cx, y);
        if (el && el.closest('.cm-line')) { x = cx; break; }
      }
      if (x == null) return null;
      const x2 = Math.min(Math.max(x + 60, r.x + r.width - 8), ed.right - 8);
      return { x, y, x2: Math.max(x2, x + 40), y2: y };
    })()`);
    if (!rect) return false;
    await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await sleep(40);
    await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x2, y: rect.y2, button: 'left', buttons: 1 });
    await sleep(40);
    await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x2, y: rect.y2, button: 'left', clickCount: 1 });
    await sleep(80);
    if (await hasSelection(ws)) return true;
  }
  return false;
}

// ---- 2. 选区浮出工具条 ----
console.log('\n=== 2. 选区 → 工具条 ===');
check('拖选成功', await dragSelect(0));
await sleep(500);
check('选区末端出现「✨ 改写」工具条', await evaluate(ws, `!!document.querySelector('.rw-toolbar')`));

// ---- 3. 打开面板 + 聚焦 ----
console.log('\n=== 3. 打开内联面板 ===');
await evaluate(ws, `document.querySelector('.rw-toolbar')?.click()`);
await sleep(500);
check('面板出现', await evaluate(ws, `!!document.querySelector('.rw-panel')`));
check('输入框聚焦', await evaluate(ws, `document.activeElement?.classList?.contains('rw-prompt') ?? false`));
check('面板打开时不再显示工具条', await evaluate(ws, `!document.querySelector('.rw-toolbar')`));

// ---- 4. 流式出稿 ----
console.log('\n=== 4. Enter 流式改写 ===');
await evaluate(ws, `(() => {
  const input = document.querySelector('.rw-prompt');
  input.value = '改写得更凝练，保留雨夜氛围';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'ok';
})()`);
await sleep(1500);
const draft = await evaluate(ws, `document.querySelector('.rw-draft')?.textContent ?? ''`);
check('草稿被流式填充', draft.includes('【改写稿】'), draft.slice(0, 30));
check('完成后「应用」按钮可用', await evaluate(ws, `!document.querySelector('.rw-accept')?.disabled`));
check('改写请求体正确(mode/原文)', assistantHits.length > 0 && assistantHits[assistantHits.length - 1].mode === 'rewrite' && assistantHits[assistantHits.length - 1].originalText !== null, JSON.stringify(assistantHits[assistantHits.length - 1] ?? null));

// ---- 5. 应用写回 + 自动保存 ----
console.log('\n=== 5. 应用写回 ===');
await evaluate(ws, `document.querySelector('.rw-accept')?.click()`);
await sleep(1400);
check('面板关闭', await evaluate(ws, `!document.querySelector('.rw-panel')`));
check('正文区间被改写稿替换', await evaluate(ws, `document.querySelector('.cm-content')?.textContent.includes('【改写稿】') ?? false`));
check('自动保存已触发(拦截到 PUT)', saveHits >= 1, `saveHits=${saveHits}`);
check('应用后选区折叠 → 无工具条', await evaluate(ws, `!document.querySelector('.rw-toolbar')`));

// ---- 6. 放弃不改原文 ----
console.log('\n=== 6. 放弃 ===');
const beforeCancel = await docStr(ws);
check('再次拖选', await dragSelect(1));
await sleep(500);
check('工具条重现', await evaluate(ws, `!!document.querySelector('.rw-toolbar')`));
await evaluate(ws, `document.querySelector('.rw-toolbar')?.click()`);
await sleep(500);
await evaluate(ws, `document.querySelector('.rw-cancel')?.click()`);
await sleep(500);
check('放弃后面板关闭', await evaluate(ws, `!document.querySelector('.rw-panel')`));
check('原文未被改动', (await docStr(ws)) === beforeCancel);

// ---- 7. Escape 关闭 ----
console.log('\n=== 7. Escape 关闭 ===');
await dragSelect(1);
await sleep(500);
await evaluate(ws, `document.querySelector('.rw-toolbar')?.click()`);
await sleep(500);
check('Escape 前面板开着', await evaluate(ws, `!!document.querySelector('.rw-panel')`));
await evaluate(ws, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await sleep(500);
check('Escape 后面板关闭', await evaluate(ws, `!document.querySelector('.rw-panel')`));

// ---- 8. 点击编辑器折叠选区 → 无工具条 ----
console.log('\n=== 8. 无选区 → 无工具条 ===');
const clickPt = await evaluate(ws, `(() => {
  const lines = [...document.querySelectorAll('.cm-content .cm-line')].filter(l => l.textContent.trim());
  const line = lines[0];
  const r = line?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
})()`);
if (clickPt) {
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: clickPt.x, y: clickPt.y, button: 'left', clickCount: 1 });
  await sleep(40);
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickPt.x, y: clickPt.y, button: 'left', clickCount: 1 });
  await sleep(500);
}
check('折叠选区后无工具条', await evaluate(ws, `!document.querySelector('.rw-toolbar')`));

// ---- 9. 文档 tab 选中文字 → 无工具条 ----
console.log('\n=== 9. 文档 tab 无改写 ===');
await evaluate(ws, `(() => { const row = document.querySelector('.tree-doc'); if (!row) return 'NO_DOC'; row.click(); return 'ok'; })()`);
await sleep(1200);
check('文档 tab 已打开', await evaluate(ws, `document.querySelectorAll('#tabs .tab').length >= 2`));
await dragSelect(0);
await sleep(500);
check('文档 tab 选中文字无工具条', await evaluate(ws, `!document.querySelector('.rw-toolbar')`));

// ---- 10. AI 助手回归：多轮问答仍可用，无改写按钮 ----
console.log('\n=== 10. AI 助手回归 ===');
// 切回章节 tab（助手需要章节上下文）
await evaluate(ws, `(() => { const tab = [...document.querySelectorAll('#tabs .tab')][0]; if (tab) tab.click(); return 'ok'; })()`);
await sleep(500);
await evaluate(ws, `document.querySelector('#activitybar [data-view="assistant"]')?.click()`);
await sleep(800);
check('助手视图无「改写选中段落」按钮', await evaluate(ws, `![...document.querySelectorAll('#sidebar-body button')].some(b => b.textContent.includes('改写选中段落'))`));
check('助手输入框存在', await evaluate(ws, `!!document.getElementById('assistant-input')`));
await evaluate(ws, `(() => {
  const i = document.getElementById('assistant-input');
  i.value = '接下来这段怎么写更抓人？';
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'ok';
})()`);
await sleep(1500);
check('助手多轮问答流式出答', await evaluate(ws, `document.querySelector('#assistant-thread .view-item-body')?.textContent.includes('助手回答') ?? false`));

// ---- 汇总 ----
console.log('\n========== 汇总 ==========');
const pass = results.filter(Boolean).length;
console.log(`PASS ${pass}/${results.length}`);
if (pageErrors.length) {
  console.log('\n--- 页面 JS 错误 ---');
  for (const e of pageErrors.slice(0, 10)) console.log('  ', e.slice(0, 200));
}
child.kill('SIGTERM');
ws.close();
await sleep(500);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(pass === results.length ? 0 : 1);
