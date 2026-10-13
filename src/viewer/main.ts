// Viewer: dựng lại snapshot thành wireframe (div absolute theo rect + style) và chồng lên screenshot
// để kiểm tra độ chính xác của dữ liệu crawl.
import { getScreenshot, getSnapshot, listSummaries } from '../shared/storage/db';
import type { ComponentTreeNode, PageSnapshot, UINode, UIStyles } from '../shared/types';
import './viewer.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const inspect = $('inspect');
const treeEl = $('tree');
const select = $<HTMLSelectElement>('snap');
const opacity = $<HTMLInputElement>('opacity');
const outlines = $<HTMLInputElement>('outlines');
const meta = $('meta');

const INHERIT = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space'];
const VISUAL = ['background-color', 'border-width', 'border-style', 'border-color', 'border-radius', 'box-shadow', 'opacity', 'background-image'];

let snap: PageSnapshot | null = null;
let shotUrl: string | null = null;
let pinned: string | null = null;
const nodeById = new Map<string, UINode>();
const elById = new Map<string, HTMLElement>();

async function init() {
  const list = await listSummaries();
  const wanted = new URLSearchParams(location.search).get('id') ?? list[0]?.id;
  for (const s of list) {
    const o = new Option(`${s.route}${s.state !== 'base' ? ' · ' + s.state : ''}`, s.id, false, s.id === wanted);
    select.add(o);
  }
  select.onchange = () => void load(select.value);
  document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) => (r.onchange = applyMode));
  opacity.oninput = applyMode;
  outlines.onchange = () => stage.classList.toggle('outlines', outlines.checked);
  stage.classList.toggle('outlines', outlines.checked);
  window.addEventListener('resize', fit);
  if (wanted) await load(wanted);
  else meta.textContent = 'Chưa có snapshot';
}

async function load(id: string) {
  snap = (await getSnapshot(id)) ?? null;
  if (!snap) return;
  history.replaceState(null, '', `?id=${encodeURIComponent(id)}`);
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  const blob = await getScreenshot(id);
  shotUrl = blob ? URL.createObjectURL(blob) : null;
  meta.textContent = `${snap.viewport.width}×${snap.viewport.height} @${snap.viewport.devicePixelRatio}x · ${snap.stats.nodes} node · ${new Date(snap.timestamp).toLocaleString()}`;
  render();
  renderTree();
}

function render() {
  if (!snap) return;
  nodeById.clear();
  elById.clear();
  stage.innerHTML = '';
  stage.style.width = `${snap.viewport.width}px`;
  stage.style.height = `${snap.viewport.height}px`;

  const img = document.createElement('img');
  img.className = 'shot';
  if (shotUrl) img.src = shotUrl;
  stage.appendChild(img);

  const wire = document.createElement('div');
  wire.className = 'wire';
  stage.appendChild(wire);

  const styles = snap.styles;
  const walk = (n: UINode, inherited: UIStyles) => {
    const s = styles[n.styleId ?? ''] ?? {};
    const inh = { ...inherited };
    for (const p of INHERIT) if (s[p]) inh[p] = s[p];
    nodeById.set(n.id, n);

    const d = document.createElement('div');
    d.className = 'n';
    d.dataset.id = n.id;
    Object.assign(d.style, {
      left: `${n.rect.x}px`,
      top: `${n.rect.y}px`,
      width: `${n.rect.width}px`,
      height: `${n.rect.height}px`,
    });
    for (const p of VISUAL) {
      if (!s[p]) continue;
      if (p === 'background-image' && s[p].includes('<ASSET>')) continue;
      d.style.setProperty(p, s[p]);
    }
    if (n.text) {
      for (const p of INHERIT) if (inh[p]) d.style.setProperty(p, inh[p]);
      d.textContent = n.text;
      d.classList.add('t');
      if (s.padding) d.style.padding = s.padding;
      const align = s['align-items'] ?? (s.display?.includes('flex') ? 'center' : undefined);
      if (align) d.style.alignItems = align;
      const justify = s['justify-content'] ?? (inh['text-align'] === 'center' ? 'center' : undefined);
      if (justify) d.style.justifyContent = justify;
    }
    if (n.component === 'Icon' || n.assetIndex !== undefined) d.classList.add('asset');
    wire.appendChild(d);
    elById.set(n.id, d);
    for (const c of n.children) walk(c, inh);
  };
  walk(snap.root, {});

  wire.onmousemove = (e) => {
    if (pinned) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('.n');
    if (t?.dataset.id) show(t.dataset.id);
  };
  wire.onclick = (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.n');
    pinned = pinned === t?.dataset.id ? null : t?.dataset.id ?? null;
    if (pinned) show(pinned);
  };
  applyMode();
  fit();
}

function applyMode() {
  const mode = document.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value ?? 'overlay';
  const img = stage.querySelector<HTMLImageElement>('.shot');
  const wire = stage.querySelector<HTMLElement>('.wire');
  if (!img || !wire) return;
  img.style.display = mode === 'wireframe' || !shotUrl ? 'none' : 'block';
  img.style.opacity = mode === 'overlay' ? String(Number(opacity.value) / 100) : '1';
  wire.style.display = mode === 'screenshot' ? 'none' : 'block';
}

function fit() {
  if (!snap) return;
  const wrap = stage.parentElement!;
  const scale = Math.min(1, (wrap.clientWidth - 16) / snap.viewport.width);
  stage.style.transform = `scale(${scale})`;
  wrap.style.height = `${snap.viewport.height * scale + 16}px`;
}

function show(id: string) {
  const n = nodeById.get(id);
  if (!n || !snap) return;
  elById.forEach((el) => el.classList.remove('hl'));
  elById.get(id)?.classList.add('hl');
  const s = snap.styles[n.styleId ?? ''] ?? {};
  const asset = n.assetIndex !== undefined ? snap.assets[n.assetIndex] : undefined;
  inspect.innerHTML = '';
  const add = (k: string, v: string) => {
    const row = document.createElement('div');
    row.className = 'kv';
    row.innerHTML = `<span></span><code></code>`;
    row.children[0].textContent = k;
    row.children[1].textContent = v;
    inspect.appendChild(row);
  };
  add('id', n.id);
  add('tag', n.tag + (n.role ? ` [role=${n.role}]` : ''));
  if (n.component) add('component', n.component);
  if (n.sig) add('signature', n.sig);
  if (n.text) add('text', n.text);
  add('rect', `${n.rect.x}, ${n.rect.y} · ${n.rect.width}×${n.rect.height}`);
  for (const [k, v] of Object.entries(n.attributes)) add('@' + k, v);
  for (const [k, v] of Object.entries(s)) add(k, v);
  if (asset) add('asset', JSON.stringify(asset));
}

function renderTree() {
  treeEl.innerHTML = '';
  if (!snap?.componentTree) return;
  const build = (t: ComponentTreeNode, depth: number) => {
    if (depth > 12) return;
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = `${depth * 12}px`;
    row.textContent = t.name + (t.count ? ` × ${t.count}` : '');
    row.onclick = () => {
      pinned = t.nodeId;
      show(t.nodeId);
      elById.get(t.nodeId)?.scrollIntoView({ block: 'nearest' });
    };
    treeEl.appendChild(row);
    t.children.forEach((c) => build(c, depth + 1));
  };
  build(snap.componentTree, 0);
}

void init();
