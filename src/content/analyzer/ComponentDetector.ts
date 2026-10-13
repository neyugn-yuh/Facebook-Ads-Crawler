// Suy luận component từ tag / ARIA role / computed style / kích thước / cấu trúc con,
// tạo signature cấu trúc và gom các component lặp lại (TableRow × N, Button × N...).
import type { ComponentGroup, ComponentTreeNode, ComponentType, UINode, UIStyles } from '../../shared/types';
import { hash, isTransparent } from '../../shared/utils';

export function implicitRole(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(' ')[0];
  const tag = el.localName;
  switch (tag) {
    case 'button': return 'button';
    case 'a': return el.hasAttribute('href') ? 'link' : undefined;
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'aside': return 'complementary';
    case 'header': return el.closest('article, section, aside, main, nav') ? undefined : 'banner';
    case 'footer': return el.closest('article, section, aside, main, nav') ? undefined : 'contentinfo';
    case 'form': return 'form';
    case 'table': return 'table';
    case 'thead': case 'tbody': case 'tfoot': return 'rowgroup';
    case 'tr': return 'row';
    case 'th': return 'columnheader';
    case 'td': return 'cell';
    case 'ul': case 'ol': return 'list';
    case 'li': return 'listitem';
    case 'dialog': return 'dialog';
    case 'hr': return 'separator';
    case 'img': return 'img';
    case 'textarea': return 'textbox';
    case 'select': return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
    case 'progress': return 'progressbar';
    case 'label': return 'label';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'input': {
      const t = (el as HTMLInputElement).type;
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'search') return 'searchbox';
      if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
      return 'textbox';
    }
  }
  return undefined;
}

const ROLE_MAP: Record<string, ComponentType> = {
  button: 'Button', link: 'Link', textbox: 'Input', searchbox: 'Input', combobox: 'Select', listbox: 'Menu',
  checkbox: 'Checkbox', radio: 'Radio', switch: 'Toggle',
  table: 'Table', grid: 'Table', treegrid: 'Table', row: 'TableRow', columnheader: 'TableHeaderCell',
  cell: 'TableCell', gridcell: 'TableCell', rowheader: 'TableCell',
  dialog: 'Modal', alertdialog: 'Modal', navigation: 'Navigation', banner: 'Header', main: 'Main',
  complementary: 'Sidebar', contentinfo: 'Footer', toolbar: 'Toolbar', search: 'SearchBar',
  tablist: 'Tabs', tab: 'Tab', menu: 'Menu', menubar: 'Menu', menuitem: 'MenuItem', menuitemcheckbox: 'MenuItem',
  menuitemradio: 'MenuItem', option: 'MenuItem', tooltip: 'Tooltip', progressbar: 'ProgressBar', heading: 'Heading',
  list: 'List', listitem: 'ListItem', separator: 'Divider', alert: 'Alert', status: 'Alert', form: 'Form',
  img: 'Image', label: 'Label',
};

export interface DetectContext {
  inHeader: boolean;
  inSidebar: boolean;
}

/** Nhận diện component trong lúc duyệt DOM (có đủ element + computed style). */
export function detectComponent(
  el: Element,
  role: string | undefined,
  cs: CSSStyleDeclaration,
  rect: DOMRect,
  ownText: string,
  ctx: DetectContext,
): ComponentType | undefined {
  const tag = el.localName;
  if (tag === 'svg') return rect.width <= 40 && rect.height <= 40 ? 'Icon' : 'Image';
  if (tag === 'textarea') return 'TextArea';
  if (role === 'img' || tag === 'img') return rect.width <= 40 && rect.height <= 40 ? 'Icon' : 'Image';
  if (role === 'button') {
    const hasLabelText = ownText.trim().length > 0 || !!el.textContent?.trim();
    return hasLabelText ? 'Button' : 'IconButton';
  }
  if (role === 'row' && (el.closest('thead') || el.querySelector(':scope > th, :scope > [role="columnheader"]'))) return 'TableHeader';
  if (role && ROLE_MAP[role]) return ROLE_MAP[role];

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const position = cs.position;
  const bg = cs.backgroundColor;

  // Header dạng div: dải ngang trên cùng, full width
  if (!ctx.inHeader && rect.top <= 2 && rect.width >= vw * 0.9 && rect.height >= 36 && rect.height <= 96 && (position === 'fixed' || position === 'sticky' || !isTransparent(bg))) {
    return 'Header';
  }
  // Sidebar dạng div: cột dọc bên trái/phải, cao gần full viewport
  if (!ctx.inSidebar && rect.height >= vh * 0.7 && rect.width >= 40 && rect.width <= 400 && (rect.left <= 2 || rect.right >= vw - 2) && rect.width < vw * 0.4) {
    return 'Sidebar';
  }
  // Popover: nổi (fixed/absolute) có shadow và z-index
  if ((position === 'fixed' || position === 'absolute') && cs.boxShadow !== 'none' && cs.zIndex !== 'auto' && rect.width >= 80 && rect.height >= 40) {
    return 'Popover';
  }
  // Badge / pill: nhỏ, có nền, bo tròn, text ngắn
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  if (ownText && ownText.length <= 24 && rect.height <= 28 && rect.width <= 160 && !isTransparent(bg) && radius >= 4) {
    return 'Badge';
  }
  if (tag === 'hr' || ((rect.height <= 1.5 || rect.width <= 1.5) && (rect.width >= 16 || rect.height >= 16) && !isTransparent(bg))) {
    return 'Divider';
  }
  return undefined;
}

// ─── Post-pass: Toolbar/Card, signature, group, component tree ───────────────

function styleSig(s: UIStyles): string {
  return [
    s.display, s['flex-direction'], s['background-color'], s['border-radius'], s['border-width'],
    s['font-size'], s['font-weight'], s['box-shadow'],
  ].map((v) => v ?? '').join('|');
}

function countDesc(n: UINode): number {
  let c = 0;
  for (const ch of n.children) c += 1 + countDesc(ch);
  return c;
}

export function refineComponents(root: UINode, getStyle: (id?: string) => UIStyles): void {
  const visit = (n: UINode) => {
    n.children.forEach(visit);
    if (n.component) return;
    const s = getStyle(n.styleId);
    const buttons = n.children.filter((c) => c.component === 'Button' || c.component === 'IconButton' || c.component === 'Select' || c.component === 'Input').length;
    if (s.display?.includes('flex') && (s['flex-direction'] ?? 'row') === 'row' && buttons >= 3 && n.rect.height <= 72) {
      n.component = 'Toolbar';
      return;
    }
    const decorated = !isTransparent(s['background-color']) || s['border-width'] !== undefined || s['box-shadow'] !== undefined;
    const radius = parseFloat(s['border-radius'] ?? '0');
    if (decorated && radius >= 4 && n.rect.width >= 120 && n.rect.height >= 60 && n.children.length >= 2) {
      n.component = 'Card';
    }
  };
  visit(root);
}

/** Signature bottom-up. Các con liên tiếp cùng signature được gộp (vd 10 hay 12 row đều cùng sig bảng). */
export function computeSignatures(root: UINode, getStyle: (id?: string) => UIStyles): void {
  const visit = (n: UINode): string => {
    const childSigs = n.children.map(visit);
    const collapsed: string[] = [];
    for (const s of childSigs) {
      const last = collapsed[collapsed.length - 1];
      if (last === s || last === s + '*') collapsed[collapsed.length - 1] = s + '*';
      else collapsed.push(s);
    }
    n.sig = hash(`${n.tag}|${n.role ?? ''}|${n.component ?? ''}|${styleSig(getStyle(n.styleId))}|${collapsed.join(',')}`);
    return n.sig;
  };
  visit(root);
}

export function groupComponents(root: UINode): ComponentGroup[] {
  const bySig = new Map<string, UINode[]>();
  const walk = (n: UINode) => {
    if (n.sig && (n.component || countDesc(n) >= 2)) {
      const list = bySig.get(n.sig) ?? [];
      list.push(n);
      bySig.set(n.sig, list);
    }
    n.children.forEach(walk);
  };
  walk(root);

  const groups: ComponentGroup[] = [];
  for (const [sig, nodes] of bySig) {
    if (nodes.length < 2) continue;
    const ex = nodes[0];
    const type = ex.component ?? 'Pattern';
    groups.push({
      signature: sig,
      type,
      name: `${type}_${sig.slice(0, 5)}`,
      count: nodes.length,
      exampleNodeId: ex.id,
      nodeIds: nodes.slice(0, 50).map((n) => n.id),
      size: { width: Math.round(ex.rect.width), height: Math.round(ex.rect.height) },
    });
  }
  // Đặt tên thân thiện: nếu chỉ có 1 group của 1 type → dùng tên type
  const typeCount = new Map<string, number>();
  groups.forEach((g) => typeCount.set(g.type, (typeCount.get(g.type) ?? 0) + 1));
  groups.forEach((g) => {
    if (g.type !== 'Pattern' && typeCount.get(g.type) === 1) g.name = g.type;
  });
  return groups.sort((a, b) => b.count * b.size.width * b.size.height - a.count * a.size.width * a.size.height).slice(0, 300);
}

/** Cây rút gọn chỉ gồm component, các anh em liên tiếp cùng signature gộp thành "X × N". */
export function buildComponentTree(root: UINode): ComponentTreeNode {
  const build = (n: UINode): ComponentTreeNode[] => {
    const kids: ComponentTreeNode[] = [];
    let prevSig: string | undefined;
    for (const c of n.children) {
      const sub = build(c);
      if (sub.length === 1 && c.component && c.sig === prevSig && kids.length) {
        const last = kids[kids.length - 1];
        last.count = (last.count ?? 1) + 1;
        continue;
      }
      kids.push(...sub);
      prevSig = c.component ? c.sig : undefined;
    }
    if (n.component) return [{ name: n.component, nodeId: n.id, children: kids }];
    return kids;
  };
  return { name: 'Page', nodeId: root.id, children: build(root).flatMap((c) => (c.name === 'Page' ? c.children : [c])) };
}

export function countComponents(root: UINode): number {
  let c = 0;
  const walk = (n: UINode) => {
    if (n.component) c++;
    n.children.forEach(walk);
  };
  walk(root);
  return c;
}
