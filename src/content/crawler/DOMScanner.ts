// Duyệt DOM (iterative, có yield để không block UI), lọc node ẩn, gộp wrapper,
// lấy text/attribute/style/rect/asset/component cho mỗi node có ý nghĩa UI.
import { IGNORED_TAGS, KEPT_ATTRIBUTES, LEAF_TAGS } from '../../shared/constants';
import type { AssetInfo, CrawlerConfig, UINode } from '../../shared/types';
import { detectAsset } from '../analyzer/AssetDetector';
import { detectComponent, implicitRole, type DetectContext } from '../analyzer/ComponentDetector';
import { intersectsViewport, sameRect, toRect } from '../analyzer/LayoutAnalyzer';
import { extractStyles, StyleTable } from '../analyzer/StyleAnalyzer';
import type { DataSanitizer } from '../sanitizer/DataSanitizer';

export interface ScanContext extends DetectContext {
  depth: number;
  dataRegion: boolean;
  parentInherited: Record<string, string> | null;
  parentDisplay: string;
}

interface NodeMeta {
  el: Element;
  parent: UINode | null;
  ctx: ScanContext;
}

interface StackItem {
  el: Element;
  parent: UINode | null;
  ctx: ScanContext;
}

export interface ScanProgress {
  visited: number;
  nodes: number;
  total: number;
}

const YIELD_EVERY = 400;
const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));

export const ROOT_CONTEXT: ScanContext = {
  depth: 0, dataRegion: false, parentInherited: null, parentDisplay: 'block', inHeader: false, inSidebar: false,
};

export class DOMScanner {
  readonly styles = new StyleTable();
  readonly assets: AssetInfo[] = [];
  readonly elementToNode = new WeakMap<Element, UINode>();
  readonly meta = new WeakMap<UINode, NodeMeta>();
  nodeCount = 0;
  visited = 0;
  truncated = false;
  private idCounter = 0;

  constructor(private cfg: CrawlerConfig, private sanitizer: DataSanitizer) {}

  nextId(): string {
    return 'n' + (this.idCounter++).toString(36);
  }

  /**
   * Scan subtree bắt đầu từ `rootEl`. Trả về danh sách node top-level được emit
   * (có thể 0 nếu ẩn, nhiều nếu display:contents / wrapper bị gộp...).
   */
  async scan(rootEl: Element, ctx: ScanContext, onProgress?: (p: ScanProgress) => void): Promise<UINode[]> {
    const out: UINode[] = [];
    const total = document.getElementsByTagName('*').length;
    const stack: StackItem[] = [{ el: rootEl, parent: null, ctx }];
    let sinceYield = 0;

    while (stack.length) {
      const item = stack.pop()!;
      this.visited++;
      const node = this.process(item, stack);
      if (node && !item.parent) out.push(node);

      if (++sinceYield >= YIELD_EVERY) {
        sinceYield = 0;
        onProgress?.({ visited: this.visited, nodes: this.nodeCount, total });
        await yieldToMain();
      }
    }
    onProgress?.({ visited: this.visited, nodes: this.nodeCount, total });
    return out;
  }

  private pushChildren(el: Element, parent: UINode | null, ctx: ScanContext, stack: StackItem[]) {
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ el: kids[i], parent, ctx });
  }

  private process({ el, parent, ctx }: StackItem, stack: StackItem[]): UINode | null {
    const tag = el.localName;
    if (IGNORED_TAGS.has(tag) || tag.includes('ui-crawler')) return null;

    const cs = getComputedStyle(el);
    const display = cs.display;
    if (display === 'none') return null;
    if (display === 'contents') {
      this.pushChildren(el, parent, ctx, stack);
      return null;
    }
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse' || cs.opacity === '0') return null;

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      // Wrapper kích thước 0 nhưng con tràn ra ngoài (anchor của popover...) → đi tiếp vào con
      if (el.childElementCount && cs.overflow.startsWith('visible')) this.pushChildren(el, parent, ctx, stack);
      return null;
    }

    if (this.nodeCount >= this.cfg.maxNodes) {
      this.truncated = true;
      return null;
    }
    // Gần chạm giới hạn → ưu tiên node trong/gần viewport
    if (this.nodeCount > this.cfg.maxNodes * 0.7 && !intersectsViewport(r, 0.5)) {
      this.truncated = true;
      return null;
    }

    const role = implicitRole(el);
    const ownText = this.cfg.extractText && tag !== 'textarea' ? directText(el) : '';

    if (this.cfg.collapseWrappers && parent && this.isPassThrough(el, tag, cs, r, role, ownText)) {
      stack.push({ el: el.firstElementChild!, parent, ctx });
      return null;
    }

    const node: UINode = {
      id: this.nextId(),
      tag,
      attributes: {},
      rect: toRect(r),
      children: [],
    };
    if (role) node.role = role;

    const isCell = role === 'cell' || role === 'gridcell' || role === 'rowheader';
    const isHeaderCell = role === 'columnheader';
    const dataRegion = isHeaderCell ? false : ctx.dataRegion || isCell || el.getAttribute('contenteditable') === 'true';
    const textCtx = { dataRegion };

    for (const name of KEPT_ATTRIBUTES) {
      const v = el.getAttribute(name);
      if (v === null) continue;
      const clean = this.sanitizer.attr(name, v, textCtx);
      if (clean !== null) node.attributes[name] = clean;
    }
    if (ownText) node.text = this.sanitizer.text(node, ownText, textCtx);

    let bgUrl: string | null = null;
    let inherited: Record<string, string> | null = ctx.parentInherited;
    if (this.cfg.extractStyles) {
      const res = extractStyles(tag, cs, ctx.parentInherited, ctx.parentDisplay, (u) => (bgUrl ??= u));
      node.styleId = this.styles.add(res.styles);
      inherited = res.inherited;
    }

    if (this.cfg.extractAssets) {
      const asset = detectAsset(el, cs, r, node.id, bgUrl, (v) => this.sanitizer.attr('alt', v, textCtx) ?? '');
      if (asset) {
        node.assetIndex = this.assets.length;
        this.assets.push(asset);
      }
    }

    if (this.cfg.detectComponents) {
      const c = detectComponent(el, role, cs, r, ownText, ctx);
      if (c) node.component = c;
    }

    if (parent) parent.children.push(node);
    this.nodeCount++;
    this.elementToNode.set(el, node);
    this.meta.set(node, { el, parent, ctx });

    if (LEAF_TAGS.has(tag)) return node;
    if (ctx.depth + 1 > this.cfg.maxDepth) {
      if (el.childElementCount) this.truncated = true;
      return node;
    }

    const childCtx: ScanContext = {
      depth: ctx.depth + 1,
      dataRegion,
      parentInherited: inherited,
      parentDisplay: display,
      inHeader: ctx.inHeader || node.component === 'Header',
      inSidebar: ctx.inSidebar || node.component === 'Sidebar',
    };
    this.pushChildren(el, node, childCtx, stack);
    return node;
  }

  /** div/span chỉ bọc đúng 1 con, cùng kích thước, không có style hiển thị riêng → bỏ qua. */
  private isPassThrough(el: Element, tag: string, cs: CSSStyleDeclaration, r: DOMRect, role: string | undefined, ownText: string): boolean {
    if (tag !== 'div' && tag !== 'span') return false;
    if (role || ownText || el.childElementCount !== 1) return false;
    if (el.hasAttribute('aria-label') || el.hasAttribute('tabindex') || el.hasAttribute('data-testid')) return false;
    const child = el.firstElementChild!;
    if (IGNORED_TAGS.has(child.localName)) return false;
    if (
      !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(cs.backgroundColor) ||
      cs.backgroundImage !== 'none' ||
      cs.borderTopWidth !== '0px' || cs.borderRightWidth !== '0px' || cs.borderBottomWidth !== '0px' || cs.borderLeftWidth !== '0px' ||
      cs.boxShadow !== 'none' ||
      cs.padding !== '0px' ||
      !cs.overflow.startsWith('visible') ||
      (cs.position !== 'static' && cs.position !== 'relative') ||
      cs.opacity !== '1' ||
      cs.transform !== 'none' ||
      cs.cursor === 'pointer'
    ) {
      return false;
    }
    return sameRect(r, child.getBoundingClientRect());
  }
}

/** Text trực tiếp (không tính text của element con), gộp khoảng trắng. */
function directText(el: Element): string {
  let t = '';
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === Node.TEXT_NODE) t += n.nodeValue;
  }
  return t.replace(/\s+/g, ' ').trim();
}
