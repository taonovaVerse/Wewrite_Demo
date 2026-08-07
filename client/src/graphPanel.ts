// 主编辑区关系图板：纯手写 SVG + 力导向布局（零依赖）。
// 只管画与交互，不碰数据来源——外部通过 setData 喂人物/边，回调通知选中/连线。

export interface GraphEdge {
  a: number;
  b: number;
  label: string;
  note?: string;
}

interface SimNode {
  id: number;
  name: string;
  main: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Callbacks {
  onNodeSelect: ((id: number) => void) | null;
  onEdgeSelect: ((index: number) => void) | null;
  onLink: ((a: number, b: number) => void) | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

let panel: HTMLDivElement | null = null;
let svg: SVGSVGElement | null = null;
let content: SVGGElement | null = null;

let chars: { id: number; name: string; main: boolean }[] = [];
let edges: GraphEdge[] = [];
let nodes: SimNode[] = [];
let selectedNode: number | null = null;
let selectedEdge: number | null = null;
let linkMode = false;
let linkFirst: number | null = null;
let fitted = false;

// 右栏图板宽度：拖动分隔条调整，持久化到 localStorage
const GRAPH_MIN_W = 200;
const GRAPH_MAX_W = 720;
const GRAPH_DEFAULT_W = 340;
const GRAPH_W_KEY = 'wewrite.graphWidth';
let resizer: HTMLDivElement | null = null;
let resizeActive = false;

const view = { tx: 20, ty: 20, s: 1 };
const cbs: Callbacks = { onNodeSelect: null, onEdgeSelect: null, onLink: null };

let dragNode: SimNode | null = null;
let dragLast = { x: 0, y: 0 };
let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
let panActive = false;

function svgEl(
  tag: string,
  cls: string,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  if (cls) el.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

function panelSize(): { width: number; height: number } {
  const w = panel?.clientWidth ?? 0;
  const h = panel?.clientHeight ?? 0;
  return { width: w > 0 ? w : 800, height: h > 0 ? h : 600 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---- 力导向布局 + 自适应取景 ----

function layout(): void {
  const { width, height } = panelSize();
  nodes = chars.map((c) => ({ ...c, x: 0, y: 0, vx: 0, vy: 0 }));
  const n = nodes.length;
  if (n === 0) {
    fitted = true;
    return;
  }
  const cx = width / 2;
  const cy = height / 2;
  const ring = Math.min(width, height) * 0.3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const nd = nodes[i];
    nd.x = cx + Math.cos(a) * ring + (Math.random() - 0.5) * ring * 0.3;
    nd.y = cy + Math.sin(a) * ring + (Math.random() - 0.5) * ring * 0.3;
  }
  const springLen = 90;
  const repulsion = 4200;
  const spring = 0.015;
  const center = 0.012;
  const damp = 0.85;
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  for (let step = 0; step < 320; step++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = repulsion / (d * d + 0.1);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    for (const e of edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (d - springLen) * spring;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const nd of nodes) {
      nd.vx += (cx - nd.x) * center;
      nd.vy += (cy - nd.y) * center;
      nd.vx *= damp;
      nd.vy *= damp;
      nd.x += nd.vx;
      nd.y += nd.vy;
    }
  }
  fit();
  fitted = true;
}

function fit(): void {
  const { width, height } = panelSize();
  if (nodes.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const nd of nodes) {
    minX = Math.min(minX, nd.x);
    minY = Math.min(minY, nd.y);
    maxX = Math.max(maxX, nd.x);
    maxY = Math.max(maxY, nd.y);
  }
  const pad = 80;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  view.s = clamp(Math.min((width - pad * 2) / bw, (height - pad * 2) / bh, 1.4), 0.15, 2.2);
  view.tx = width / 2 - ((minX + maxX) / 2) * view.s;
  view.ty = height / 2 - ((minY + maxY) / 2) * view.s;
}

// ---- 渲染 ----

function render(): void {
  if (!svg || !content) return;
  const cg = content;
  content.innerHTML = '';
  if (nodes.length === 0) {
    content.setAttribute('transform', '');
    const { width, height } = panelSize();
    const t = svgEl('text', 'graph-empty', { x: width / 2, y: height / 2 }, '还没有人物，点侧边栏 ＋人物 创建');
    t.setAttribute('text-anchor', 'middle');
    content.appendChild(t);
    return;
  }
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  content.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.s})`);
  edges.forEach((e, idx) => {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) return;
    const g = svgEl('g', 'graph-edge' + (selectedEdge === idx ? ' selected' : ''));
    const x1 = a.x;
    const y1 = a.y;
    const x2 = b.x;
    const y2 = b.y;
    g.appendChild(svgEl('line', 'graph-edge-line', { x1, y1, x2, y2 }));
    g.appendChild(
      svgEl('line', 'graph-edge-hit', { x1, y1, x2, y2, 'data-edge-idx': String(idx) }),
    );
    if (e.label) {
      g.appendChild(
        svgEl('text', 'graph-edge-label', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, e.label),
      );
    }
    cg.appendChild(g);
  });
  for (const nd of nodes) {
    const g = svgEl(
      'g',
      'graph-node' + (nd.main ? ' main' : '') + (selectedNode === nd.id ? ' selected' : ''),
    );
    const r = nd.main ? 20 : 13;
    g.appendChild(svgEl('circle', 'graph-node-circle', { cx: nd.x, cy: nd.y, r }));
    g.appendChild(svgEl('text', 'graph-node-text', { x: nd.x, y: nd.y + r + 13 }, nd.name));
    g.setAttribute('data-node-id', String(nd.id));
    cg.appendChild(g);
  }
}

// ---- 交互 ----

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  view.s = clamp(view.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.15, 5);
  render();
}

function onPointerDown(e: PointerEvent): void {
  if (!svg) return;
  const nodeHit = (e.target as Element).closest('[data-node-id]');
  if (nodeHit) {
    const id = Number(nodeHit.getAttribute('data-node-id'));
    selectNode(id);
    const nd = nodes.find((x) => x.id === id);
    if (nd) {
      dragNode = nd;
      dragLast = { x: e.clientX, y: e.clientY };
      svg.setPointerCapture(e.pointerId);
    }
    return;
  }
  const edgeHit = (e.target as Element).closest('[data-edge-idx]');
  if (edgeHit) {
    selectEdge(Number(edgeHit.getAttribute('data-edge-idx')));
    return;
  }
  panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  panActive = true;
  svg.classList.add('panning');
  svg.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  if (dragNode) {
    dragNode.x += (e.clientX - dragLast.x) / view.s;
    dragNode.y += (e.clientY - dragLast.y) / view.s;
    dragLast = { x: e.clientX, y: e.clientY };
    render();
  } else if (panActive) {
    view.tx = panStart.tx + (e.clientX - panStart.x);
    view.ty = panStart.ty + (e.clientY - panStart.y);
    render();
  }
}

function onPointerUp(): void {
  dragNode = null;
  panActive = false;
  svg?.classList.remove('panning');
}

function selectNode(id: number | null): void {
  if (linkMode) {
    if (id == null) return;
    if (linkFirst == null || linkFirst === id) {
      linkFirst = id;
      render();
    } else {
      const a = linkFirst;
      linkFirst = null;
      setLinkMode(false);
      cbs.onLink?.(a, id);
    }
    return;
  }
  selectedNode = id;
  selectedEdge = null;
  render();
  if (id != null) cbs.onNodeSelect?.(id);
}

function selectEdge(idx: number): void {
  selectedEdge = idx;
  selectedNode = null;
  render();
  cbs.onEdgeSelect?.(idx);
}

// ---- 对外 API ----

function loadGraphWidth(): number {
  try {
    const raw = localStorage.getItem(GRAPH_W_KEY);
    if (raw != null) {
      const v = Number(raw);
      if (Number.isFinite(v)) return v;
    }
  } catch { }
  return GRAPH_DEFAULT_W;
}

function applyGraphWidth(w: number): void {
  const width = clamp(Math.round(w), GRAPH_MIN_W, GRAPH_MAX_W);
  if (panel) {
    panel.style.width = `${width}px`;
    panel.style.flexBasis = `${width}px`;
  }
}

function persistGraphWidth(): void {
  const w = panel?.clientWidth ?? GRAPH_DEFAULT_W;
  try {
    localStorage.setItem(GRAPH_W_KEY, String(w));
  } catch { }
}

function onResizerDown(e: PointerEvent): void {
  resizeActive = true;
  e.preventDefault();
  resizer?.classList.add('active');
  resizer?.setPointerCapture(e.pointerId);
}

function onResizerMove(e: PointerEvent): void {
  if (!resizeActive) return;
  const split = document.getElementById('editor-split');
  if (!split) return;
  // 分隔条左边界即图板右边界：宽度 = 分栏右缘 − 指针 x
  applyGraphWidth(split.getBoundingClientRect().right - e.clientX);
}

function onResizerUp(): void {
  resizeActive = false;
  resizer?.classList.remove('active');
  persistGraphWidth();
}

function mount(): void {
  const area = document.getElementById('editor-area');
  if (!area || document.getElementById('graph-panel')) return;
  // 图板与编辑器左右分栏共存：#editor-split 内左编辑器、右图板，互不遮盖
  const split = document.createElement('div');
  split.id = 'editor-split';
  const wrap = document.getElementById('editor-wrap');
  if (wrap && wrap.parentElement === area) {
    area.insertBefore(split, wrap);
    split.appendChild(wrap);
  } else {
    area.appendChild(split);
  }
  panel = document.createElement('div');
  panel.id = 'graph-panel';
  panel.className = 'hidden';
  svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'graph-canvas');
  content = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(content);
  panel.appendChild(svg);
  resizer = document.createElement('div');
  resizer.id = 'graph-resizer';
  resizer.className = 'graph-resizer hidden';
  split.appendChild(resizer);
  split.appendChild(panel);
  applyGraphWidth(loadGraphWidth());
  resizer.addEventListener('pointerdown', onResizerDown);
  resizer.addEventListener('pointermove', onResizerMove);
  resizer.addEventListener('pointerup', onResizerUp);
  resizer.addEventListener('pointercancel', onResizerUp);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', () => {
    if (visible()) render();
  });
}

function visible(): boolean {
  return panel != null && !panel.classList.contains('hidden');
}

/** 图板显示 ⇔ 当前视图是人物卡；与编辑器左右分栏共存，互不隐藏 */
function syncVisibility(viewId: string): void {
  if (!panel) return;
  const show = viewId === 'characters';
  const wasVisible = visible();
  panel.classList.toggle('hidden', !show);
  resizer?.classList.toggle('hidden', !show);
  if (show && !wasVisible) {
    if (!fitted) layout();
    render();
  }
}

function setData(
  characterList: { id: number; name: string; main: boolean }[],
  edgeList: GraphEdge[],
): void {
  chars = characterList;
  const ids = new Set(chars.map((c) => c.id));
  edges = edgeList.filter((e) => ids.has(e.a) && ids.has(e.b));
  selectedEdge = null;
  if (selectedNode != null && !ids.has(selectedNode)) selectedNode = null;
  fitted = false;
  if (visible()) {
    layout();
    render();
  } else {
    nodes = [];
  }
}

function refresh(): void {
  fitted = false;
  if (visible()) {
    layout();
    render();
  }
}

function selectNodeProgrammatic(id: number | null): void {
  linkMode = false;
  linkFirst = null;
  selectedNode = id;
  selectedEdge = null;
  render();
}

function clearSelection(): void {
  selectedNode = null;
  selectedEdge = null;
  render();
}

function setLinkMode(on: boolean): void {
  linkMode = on;
  linkFirst = null;
  render();
}

function selectEdgeProgrammatic(idx: number | null): void {
  linkMode = false;
  linkFirst = null;
  selectedEdge = idx;
  selectedNode = null;
  render();
}

export const graphPanel = {
  mount,
  syncVisibility,
  setData,
  refresh,
  selectNode: selectNodeProgrammatic,
  selectEdge: selectEdgeProgrammatic,
  clearSelection,
  setLinkMode,
  get selectedNodeId() {
    return selectedNode;
  },
  get isLinkMode() {
    return linkMode;
  },
  onNodeSelect(cb: (id: number) => void): void {
    cbs.onNodeSelect = cb;
  },
  onEdgeSelect(cb: (index: number) => void): void {
    cbs.onEdgeSelect = cb;
  },
  onLink(cb: (a: number, b: number) => void): void {
    cbs.onLink = cb;
  },
};
