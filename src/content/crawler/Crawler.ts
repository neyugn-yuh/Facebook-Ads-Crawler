// Điều phối: detect page → đợi UI stable → screenshot → scan DOM → phân tích → lưu snapshot.
// Sau đó theo dõi route change (snapshot mới), overlay (modal/menu → state riêng)
// và mutation nhỏ (crawl lại subtree rồi merge).
import { CRAWLER_VERSION, OVERLAY_ROLES } from '../../shared/constants';
import type { CaptureResult, SaveResult, ToBackground } from '../../shared/messages';
import type { CrawlerConfig, CrawlerStatus, PageSnapshot, UINode, UIStyles } from '../../shared/types';
import { isTargetUrl, routeFromUrl, slugify } from '../../shared/utils';
import { buildComponentTree, computeSignatures, countComponents, groupComponents, refineComponents } from '../analyzer/ComponentDetector';
import { viewportInfo } from '../analyzer/LayoutAnalyzer';
import { extractTokens, tokenCount } from '../analyzer/TokenExtractor';
import { RouteObserver } from '../route/RouteObserver';
import { DataSanitizer } from '../sanitizer/DataSanitizer';
import { DOMScanner, ROOT_CONTEXT } from './DOMScanner';
import { MutationTracker } from './MutationTracker';
import { waitForStableDOM, waitForVisible } from './StabilityDetector';

type Status = Omit<CrawlerStatus, 'tabId' | 'updatedAt'>;

const INCREMENTAL_SAVE_INTERVAL = 3000;
const MAX_INCREMENTAL_ROOTS = 25;
const MAX_OVERLAY_TABS = 12;
const MAX_MENU_PAGES = 30;

export class Crawler {
  private sanitizer: DataSanitizer;
  private scanner: DOMScanner;
  private root: UINode | null = null;
  private route = '';
  private stateKey = 'base';
  private enabled = false;
  private forced = false;
  private crawling = false;
  private deepDone = false; // popup hiện tại đã crawl sâu rồi (reset khi về state base)
  private deepNote = '';
  private rerunReason: string | null = null;
  private dead = false;
  private lastSaveAt = 0;
  private saveTimer: number | undefined;
  private incrementalQueue: Promise<void> = Promise.resolve();
  private tracker: MutationTracker;
  private routes: RouteObserver;
  private status: Status = { phase: 'idle', progress: 0, nodes: 0, components: 0, tokens: 0, screenshot: null };
  private lastStatusSent = 0;

  constructor(private cfg: CrawlerConfig) {
    this.sanitizer = new DataSanitizer(cfg);
    this.scanner = new DOMScanner(cfg, this.sanitizer);
    this.tracker = new MutationTracker(cfg.mutationDebounceMs, (els) => this.onMutations(els), () => this.routes.check());
    this.routes = new RouteObserver((url) => this.onRouteChange(url));
  }

  // ─── Public ───────────────────────────────────────────────────────────────

  start() {
    this.routes.start();
    if (!isTargetUrl(location.href, this.cfg.targetUrlPatterns)) {
      // Vẫn theo dõi route: SPA có thể điều hướng từ facebook.com vào Ads Manager
      this.tracker.start();
      this.report({ phase: 'idle', message: 'Không phải trang Ads Manager — bấm "Crawl ngay" để crawl thủ công' }, true);
      return;
    }
    if (!this.cfg.autoStart) {
      this.report({ phase: 'disabled', message: 'Auto crawl đang tắt' }, true);
      return;
    }
    this.enabled = true;
    void this.fullCrawl('auto');
  }

  /** Crawl thủ công từ side panel (kể cả khi không phải trang target). */
  crawlNow() {
    this.enabled = true;
    this.forced = true;
    void this.fullCrawl('manual');
  }

  updateConfig(cfg: CrawlerConfig) {
    const wasAuto = this.cfg.autoStart;
    this.cfg = cfg; // áp dụng đầy đủ ở lần full crawl kế tiếp
    if (!wasAuto && cfg.autoStart && !this.enabled && isTargetUrl(location.href, cfg.targetUrlPatterns)) {
      this.enabled = true;
      void this.fullCrawl('auto');
    }
  }

  // ─── Full crawl ──────────────────────────────────────────────────────────

  private async fullCrawl(reason: string): Promise<void> {
    if (this.dead) return;
    if (this.crawling) {
      this.rerunReason = reason;
      return;
    }
    this.crawling = true;
    this.tracker.setPaused(true);
    const t0 = performance.now();

    try {
      this.report({ phase: 'waiting', progress: 0, message: 'Đợi UI render ổn định…', url: location.href, route: routeFromUrl(location.href) }, true);
      await waitForVisible();
      const stable = await waitForStableDOM({ quietPeriod: this.cfg.waitForStableMs, timeout: this.cfg.stableTimeoutMs });

      const url = location.href;
      const route = routeFromUrl(url);
      const state = this.computeOverlayState();

      // Overlay có nhiều trang (tab) → crawl từng tab trước, rồi quay về tab đang mở để crawl state chính
      if (state === 'base') this.deepDone = false;
      else if (!this.deepDone) {
        this.deepDone = true; // popup đổi state giữa chừng (dropdown...) không kích hoạt crawl sâu lần nữa
        this.deepNote = '';
        await this.crawlOverlayTabs(state, route);
        await this.crawlMenuPages(state, route);
      }

      if (!(await this.scanAndSave(route, state, state, t0, !stable.stable))) this.rerunReason = 'route';
    } catch (e) {
      this.report({ phase: 'error', message: String((e as Error)?.message ?? e) }, true);
    } finally {
      this.crawling = false;
      this.tracker.setPaused(false);
      if (this.cfg.trackMutations) this.tracker.start();
      const rerun = this.rerunReason;
      this.rerunReason = null;
      if (rerun && !this.dead) void this.fullCrawl(rerun);
    }
  }

  /** Screenshot + scan + lưu 1 snapshot với stateKey cho trước. false nếu route đổi giữa chừng. */
  private async scanAndSave(route: string, reportState: string, stateKey: string, t0: number, timedOut: boolean): Promise<boolean> {
    // Screenshot trước khi scan để khớp nhất với rect
    let captured = false;
    let captureError: string | undefined;
    if (this.cfg.captureScreenshot) {
      this.report({ phase: 'crawling', progress: 2, message: 'Chụp screenshot…', route, state: reportState }, true);
      const res = await this.send<CaptureResult>({ type: 'CAPTURE_SCREENSHOT' });
      captured = !!res?.ok;
      captureError = res?.error;
    }

    this.sanitizer = new DataSanitizer(this.cfg);
    this.scanner = new DOMScanner(this.cfg, this.sanitizer);
    const nodes = await this.scanner.scan(document.body, ROOT_CONTEXT, (p) => {
      this.report({
        phase: 'crawling',
        progress: Math.min(90, 5 + Math.round((p.visited / Math.max(1, p.total)) * 85)),
        nodes: p.nodes,
        message: `Scan DOM (${p.visited.toLocaleString()} element)`,
      });
    });

    if (nodes.length) {
      this.report({ phase: 'crawling', progress: 90, message: 'Cuộn các vùng scroll để lấy đủ nội dung…' }, true);
      await this.scanner.expandScrollables(nodes);
    }

    // Route đổi trong lúc scan → bỏ kết quả
    if (routeFromUrl(location.href) !== route) return false;

    this.root = nodes.length === 1 ? nodes[0] : this.syntheticRoot(nodes);
    this.root.component = 'Page';
    this.route = route;
    this.stateKey = stateKey;

    await this.analyzeAndSave(captured, captureError, performance.now() - t0, timedOut);
    return true;
  }

  /** Overlay (modal/popup) có nhiều tab → click lần lượt, mỗi tab lưu 1 snapshot `<state>-tab-<label>`. */
  private async crawlOverlayTabs(state: string, route: string) {
    const overlay = this.findTopOverlay();
    if (!overlay) return;
    const tabs = [...overlay.querySelectorAll<HTMLElement>('[role="tab"]')].filter(isVisible);
    const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    const others = tabs.filter((t) => t !== active).slice(0, MAX_OVERLAY_TABS);
    if (!others.length) return;

    const used = new Set<string>();
    for (const [i, tab] of others.entries()) {
      realClick(tab);
      await this.waitQuiet();
      if (!overlay.isConnected) break;
      const label = slugify(this.sanitizer.applyPatterns(tab.textContent?.trim() ?? ''), 30) || `tab${i + 1}`;
      const key = `${state}-tab-${used.has(label) ? label + (i + 1) : label}`;
      used.add(label);
      if (!(await this.scanAndSave(route, state, key, performance.now(), false))) break;
    }
    if (overlay.isConnected && active) {
      realClick(active);
      await this.waitQuiet();
    }
  }

  /**
   * Popup dạng menu nhiều trang (vd. popup lọc mở khi click ô tìm kiếm: trang gốc liệt kê danh mục,
   * bấm danh mục → trang con có tiêu đề + nút quay lại). Về trang gốc, bấm lần lượt từng mục;
   * mục nào dẫn sang trang con thì lưu snapshot `<state>-page-<tiêu đề>` rồi bấm quay lại.
   */
  private note(message: string) {
    this.deepNote = message;
    this.report({ phase: 'crawling', message }, true);
  }

  private async crawlMenuPages(state: string, route: string) {
    // Overlay bị React render lại khi đổi trang → luôn tìm lại thay vì giữ tham chiếu cũ
    // Bước sâu hơn (form chọn điều kiện/giá trị...) không có role menu/dialog → fallback về lớp nổi chứa popup
    let anchor: Element | null = null;
    const getOverlay = () => this.findTopOverlay(true) ?? (anchor?.isConnected && isVisible(anchor) ? anchor : null);
    const first = getOverlay();
    if (!first) return;
    anchor = floatingAncestor(first);
    const pageHeading = () => getOverlay()?.querySelector('[role="heading"]')?.textContent?.trim() ?? '';
    const backButton = (): HTMLElement | null => {
      const overlay = getOverlay();
      const h = overlay?.querySelector('[role="heading"]');
      for (let a = h?.parentElement; overlay && a && overlay.contains(a) && a !== overlay; a = a.parentElement) {
        const b = a.querySelector<HTMLElement>('[role="button"]');
        if (b && b.compareDocumentPosition(h!) & Node.DOCUMENT_POSITION_FOLLOWING) return b;
      }
      return null;
    };
    const items = () => [...(getOverlay()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter(isVisible);
    const goBack = async () => {
      realClick(backButton());
      await this.waitQuiet();
    };

    /** Kết thúc (kể cả khi dừng giữa chừng): lùi về trang gốc để popup ở trạng thái ổn định. */
    const restore = async () => {
      for (let k = 0; k < 3 && backButton(); k++) await goBack();
    };
    try {
    this.report({ phase: 'crawling', message: backButton() ? 'Popup: quay về trang gốc…' : 'Popup: đang ở trang gốc' }, true);
    if (backButton()) await goBack(); // đang ở trang con → về trang gốc

    const count = items().length;
    const seen = new Set<string>();
    for (let i = 0; i < Math.min(count, MAX_MENU_PAGES); i++) {
      const item = items()[i];
      if (!item) break;
      const before = pageHeading();
      this.note(`Popup: mở mục ${i + 1}/${count}`);
      realClick(item);
      await this.waitQuiet();
      // Trang con có thể render trễ → chờ tối đa 3s trước khi kết luận
      for (let w = 0; w < 30 && !backButton(); w++) await new Promise((r) => setTimeout(r, 100));
      if (!getOverlay()) return; // click làm đóng popup (mục không phải điều hướng)
      if (!backButton()) continue; // vẫn ở trang gốc → không phải điều hướng
      const title = pageHeading();
      const label = slugify(this.sanitizer.applyPatterns(title), 30) || `page${i + 1}`;
      if (title !== before && !seen.has(label)) {
        seen.add(label);
        if (!(await this.scanAndSave(route, state, `${state}-page-${label}`, performance.now(), false))) return;
      }
      await goBack();
    }
    } finally {
      await restore();
    }
  }

  private syntheticRoot(children: UINode[]): UINode {
    return {
      id: this.scanner.nextId(),
      tag: 'body',
      attributes: {},
      rect: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      children,
    };
  }

  // ─── Phân tích + lưu ─────────────────────────────────────────────────────

  private async analyzeAndSave(useScreenshot: boolean, screenshotError: string | undefined, durationMs: number, timedOut: boolean) {
    if (!this.root) return;
    this.report({ phase: 'analyzing', progress: 92, message: 'Phân tích component & design tokens…' });
    const snapshot = this.buildSnapshot(durationMs);
    if (timedOut) snapshot.screenshotError = [screenshotError, 'UI chưa stable hẳn (hết timeout)'].filter(Boolean).join('; ');
    else if (screenshotError) snapshot.screenshotError = screenshotError;

    this.report({ phase: 'saving', progress: 97, message: 'Lưu snapshot…' });
    const res = await this.send<SaveResult>({ type: 'SAVE_SNAPSHOT', snapshot, useCapturedScreenshot: useScreenshot });
    this.lastSaveAt = Date.now();

    this.report(
      {
        phase: res?.ok ? (this.cfg.trackMutations ? 'watching' : 'completed') : 'error',
        progress: 100,
        route: snapshot.route,
        state: snapshot.state,
        url: snapshot.url,
        nodes: snapshot.stats.nodes,
        components: snapshot.stats.components,
        tokens: snapshot.stats.tokens,
        screenshot: res?.hasScreenshot ?? false,
        message: res?.ok
          ? `Đã lưu snapshot "${snapshot.id}"${snapshot.stats.truncated ? ' (đã cắt bớt vì vượt giới hạn node)' : ''}${this.deepNote ? ` | bước popup cuối: ${this.deepNote}` : ''}`
          : `Lưu thất bại: ${res?.error ?? 'không rõ'}`,
      },
      true,
    );
  }

  private buildSnapshot(durationMs: number): PageSnapshot {
    const table = this.scanner.styles;
    const getStyle = (id?: string): UIStyles => table.get(id);
    const root = this.root!;

    this.sanitizer.finalize(root);
    if (this.cfg.detectComponents) {
      refineComponents(root, getStyle);
      computeSignatures(root, getStyle);
    }

    // Clone để re-index asset/style mà không đụng vào cây đang sống (dùng cho incremental)
    const out: UINode = JSON.parse(JSON.stringify(root));
    const styles: Record<string, UIStyles> = {};
    const assets: PageSnapshot['assets'] = [];
    let nodes = 0;
    const walk = (n: UINode) => {
      nodes++;
      if (n.styleId && !styles[n.styleId]) styles[n.styleId] = table.get(n.styleId);
      if (n.assetIndex !== undefined) {
        const a = this.scanner.assets[n.assetIndex];
        if (a) {
          n.assetIndex = assets.length;
          assets.push(a);
        } else delete n.assetIndex;
      }
      n.children.forEach(walk);
    };
    walk(out);

    const tokens = extractTokens(out, getStyle);
    const components = this.cfg.detectComponents ? groupComponents(out) : [];
    const componentTree = this.cfg.detectComponents ? buildComponentTree(out) : null;

    return {
      id: snapshotId(this.route, this.stateKey),
      url: sanitizeUrl(location.href),
      route: this.route,
      state: this.stateKey,
      title: this.sanitizer.applyPatterns(document.title),
      timestamp: Date.now(),
      viewport: viewportInfo(),
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      stats: {
        nodes,
        domElementsVisited: this.scanner.visited,
        truncated: this.scanner.truncated,
        durationMs: Math.round(durationMs),
        components: countComponents(out),
        tokens: tokenCount(tokens),
      },
      root: out,
      styles,
      tokens,
      components,
      componentTree,
      assets,
      hasScreenshot: false,
      crawlerVersion: CRAWLER_VERSION,
    };
  }

  // ─── Route change ────────────────────────────────────────────────────────

  private onRouteChange(url: string) {
    const target = isTargetUrl(url, this.cfg.targetUrlPatterns);
    if (!target && !this.forced) {
      if (this.enabled) this.report({ phase: 'idle', message: 'Đã rời Ads Manager' }, true);
      this.enabled = false;
      this.root = null;
      return;
    }
    if (!this.enabled) {
      if (!this.cfg.autoStart) return;
      this.enabled = true;
    }
    if (routeFromUrl(url) === this.route && this.root) return; // chỉ đổi query → để mutation xử lý
    void this.fullCrawl('route');
  }

  // ─── Incremental ─────────────────────────────────────────────────────────

  private onMutations(affected: Set<Element>) {
    if (!this.enabled || !this.root || this.crawling || this.dead || !this.cfg.trackMutations) return;
    this.incrementalQueue = this.incrementalQueue.then(() => this.incremental(affected)).catch((e) => {
      this.report({ phase: 'error', message: 'Incremental lỗi: ' + String(e) }, true);
    });
  }

  private async incremental(affected: Set<Element>) {
    if (!this.root || this.crawling) return;

    // Modal/menu mở hoặc đóng → state mới → full crawl + screenshot
    const state = this.computeOverlayState();
    if (state !== this.stateKey) {
      await this.waitQuiet();
      if (this.computeOverlayState() !== this.stateKey) void this.fullCrawl('state');
      return;
    }

    const anchors = new Set<Element>();
    for (const el of affected) {
      if (!el.isConnected) continue;
      const a = this.findAnchor(el);
      if (a) anchors.add(a);
    }
    if (!anchors.size) return;
    const roots = [...anchors].filter((a) => ![...anchors].some((o) => o !== a && o.contains(a)));

    const rootEl = this.scanner.meta.get(this.root)?.el;
    if (roots.length > MAX_INCREMENTAL_ROOTS || roots.some((r) => r === rootEl)) {
      void this.fullCrawl('large-change');
      return;
    }

    const t0 = performance.now();
    for (const el of roots) {
      const ok = await this.rescan(el);
      if (!ok) {
        void this.fullCrawl('rescan-failed');
        return;
      }
    }
    this.scanner.nodeCount = countNodes(this.root);
    this.scheduleIncrementalSave(performance.now() - t0);
  }

  /** Element gần nhất (chính nó hoặc tổ tiên) đang có node trong cây. */
  private findAnchor(el: Element): Element | null {
    for (let a: Element | null = el; a; a = a.parentElement) {
      const node = this.scanner.elementToNode.get(a);
      if (!node) continue;
      if (node === this.root) return a;
      const parent = this.scanner.meta.get(node)?.parent;
      if (parent && parent.children.includes(node)) return a;
    }
    return null;
  }

  private async rescan(el: Element): Promise<boolean> {
    const node = this.scanner.elementToNode.get(el);
    const meta = node && this.scanner.meta.get(node);
    if (!node || !meta?.parent) return false;
    const parent = meta.parent;
    const idx = parent.children.indexOf(node);
    if (idx < 0) return false;

    const fresh = await this.scanner.scan(el, meta.ctx);
    for (const n of fresh) {
      const m = this.scanner.meta.get(n);
      if (m) m.parent = parent;
    }
    parent.children.splice(idx, 1, ...fresh);
    return true;
  }

  private scheduleIncrementalSave(durationMs: number) {
    clearTimeout(this.saveTimer);
    const wait = Math.max(0, INCREMENTAL_SAVE_INTERVAL - (Date.now() - this.lastSaveAt));
    this.saveTimer = window.setTimeout(() => {
      if (this.crawling || !this.root) return;
      void this.analyzeAndSave(false, undefined, durationMs, false);
    }, wait);
  }

  private waitQuiet() {
    return waitForStableDOM({ quietPeriod: this.cfg.waitForStableMs, timeout: this.cfg.stableTimeoutMs });
  }

  // ─── Overlay state ───────────────────────────────────────────────────────

  /** "base" hoặc "<role>-<label>" của overlay trên cùng đang mở (modal, menu, dropdown). */
  /** `outermost`: popup lồng nhau (menu trong menu) → lấy lớp ngoài cùng, chứa cả tiêu đề + nút quay lại. */
  private findTopOverlay(outermost = false): Element | null {
    const selector = OVERLAY_ROLES.map((r) => `[role="${r}"]`).join(',') + ',dialog[open]';
    let top: Element | null = null;
    for (const el of document.querySelectorAll(selector)) {
      if (!isVisible(el)) continue;
      const role = el.getAttribute('role') ?? 'dialog';
      if ((role === 'menu' || role === 'listbox') && !isFloating(el)) continue;
      if (outermost && top?.contains(el)) continue;
      top = el;
    }
    return top;
  }

  private computeOverlayState(): string {
    const top = this.findTopOverlay();
    if (!top) return 'base';
    const role = top.getAttribute('role') ?? 'dialog';
    const label = overlayLabel(top);
    const clean = label ? this.sanitizer.applyPatterns(label).replace(/<[A-Z]+(?::\d+)?>/g, '') : '';
    const slug = clean ? slugify(clean, 40) : '';
    return slug && slug !== 'page' ? `${role}-${slug}` : role;
  }

  // ─── Messaging ───────────────────────────────────────────────────────────

  private report(patch: Partial<Status>, force = false) {
    this.status = { ...this.status, ...patch };
    const now = Date.now();
    if (!force && now - this.lastStatusSent < 250) return;
    this.lastStatusSent = now;
    void this.send({ type: 'STATUS', status: this.status });
  }

  private async send<T>(msg: ToBackground): Promise<T | undefined> {
    if (this.dead) return undefined;
    try {
      return (await chrome.runtime.sendMessage(msg)) as T;
    } catch (e) {
      if (String(e).includes('Extension context invalidated')) {
        // Extension bị reload/gỡ → dừng mọi thứ
        this.dead = true;
        this.tracker.stop();
        this.routes.stop();
      }
      return undefined;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function snapshotId(route: string, state: string): string {
  const base = slugify(route.replace(/:id/g, 'id'), 80);
  return state === 'base' ? base : `${base}__${slugify(state, 150)}`;
}

/** Bỏ query string & số ID khỏi URL lưu trong snapshot. */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + routeFromUrl(url);
  } catch {
    return '';
  }
}

function countNodes(n: UINode): number {
  let c = 1;
  for (const ch of n.children) c += countNodes(ch);
  return c;
}

/** React/Facebook hay nghe pointer/mouse event, `el.click()` đơn thuần có thể không kích hoạt → phát đủ chuỗi sự kiện. */
function realClick(el: HTMLElement | null | undefined) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, { ...init, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(t, init));
  }
}

function isVisible(el: Element): boolean {
  const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
  if (anyEl.checkVisibility && !anyEl.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Tổ tiên gần nhất có position fixed/absolute và không phủ gần hết viewport (lớp chứa popup). */
function floatingAncestor(el: Element): Element | null {
  for (let a = el.parentElement, depth = 0; a && a !== document.body && depth < 12; a = a.parentElement, depth++) {
    const p = getComputedStyle(a).position;
    if (p !== 'fixed' && p !== 'absolute') continue;
    const r = a.getBoundingClientRect();
    return r.width < window.innerWidth * 0.6 || r.height < window.innerHeight * 0.6 ? a : null;
  }
  return null;
}

function isFloating(el: Element): boolean {
  let depth = 0;
  for (let a: Element | null = el; a && a !== document.body && depth < 12; a = a.parentElement, depth++) {
    const p = getComputedStyle(a).position;
    if (p === 'fixed' || p === 'absolute') return true;
  }
  return false;
}

function overlayLabel(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    if (t) return t;
  }
  const h = el.querySelector('h1, h2, h3, [role="heading"]');
  return h?.textContent?.trim().slice(0, 60) ?? '';
}
