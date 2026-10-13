// Thống kê giá trị CSS lặp lại → design tokens. Kèm CSS custom properties (biến màu của Facebook).
import type { DesignTokens, TokenCount, UINode, UIStyles } from '../../shared/types';
import { colorsToHex, isTransparent } from '../../shared/utils';

class Counter {
  private m = new Map<string, number>();
  add(v: string | undefined) {
    if (!v) return;
    this.m.set(v, (this.m.get(v) ?? 0) + 1);
  }
  list(limit = 60): TokenCount[] {
    return [...this.m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  get size() {
    return this.m.size;
  }
}

const splitValues = (v: string) => v.split(/\s+(?![^(]*\))/).filter(Boolean);

export function extractTokens(root: UINode, getStyle: (id?: string) => UIStyles): DesignTokens {
  const colors = new Counter();
  const text = new Counter();
  const bg = new Counter();
  const border = new Counter();
  const spacing = new Counter();
  const families = new Counter();
  const sizes = new Counter();
  const weights = new Counter();
  const lineHeights = new Counter();
  const radius = new Counter();
  const shadows = new Counter();
  const borderWidths = new Counter();

  const walk = (n: UINode) => {
    const s = getStyle(n.styleId);
    if (s.color) { text.add(s.color); colors.add(s.color); }
    if (s['background-color'] && !isTransparent(s['background-color'])) { bg.add(s['background-color']); colors.add(s['background-color']); }
    if (s['border-color']) for (const c of new Set(splitValues(s['border-color']))) { border.add(c); colors.add(c); }
    for (const p of ['margin', 'padding', 'gap', 'row-gap', 'column-gap']) {
      if (s[p]) for (const v of splitValues(s[p])) if (/^-?\d+(\.\d)?px$/.test(v) && v !== '0px' && Math.abs(parseFloat(v)) <= 128) spacing.add(v.replace('-', '')); // bỏ margin:auto đã resolve thành px lớn
    }
    if (s['font-family']) families.add(s['font-family'].split(',')[0].replace(/["']/g, '').trim());
    sizes.add(s['font-size']);
    weights.add(s['font-weight']);
    if (s['line-height'] && s['line-height'] !== 'normal') lineHeights.add(s['line-height']);
    if (s['border-radius']) for (const v of new Set(splitValues(s['border-radius']))) if (v !== '0px') radius.add(v);
    shadows.add(s['box-shadow']);
    if (s['border-width']) for (const v of new Set(splitValues(s['border-width']))) if (v !== '0px') borderWidths.add(v);
    n.children.forEach(walk);
  };
  walk(root);

  const byNum = (a: TokenCount, b: TokenCount) => parseFloat(a.value) - parseFloat(b.value);
  return {
    colors: colors.list(80),
    textColors: text.list(),
    backgroundColors: bg.list(),
    borderColors: border.list(),
    spacing: spacing.list(40).sort(byNum),
    fontFamilies: families.list(10),
    fontSizes: sizes.list(30).sort(byNum),
    fontWeights: weights.list(10).sort(byNum),
    lineHeights: lineHeights.list(30).sort(byNum),
    radius: radius.list(20).sort(byNum),
    shadows: shadows.list(20),
    borderWidths: borderWidths.list(10).sort(byNum),
    cssVariables: extractCssVariables(),
  };
}

export function tokenCount(t: DesignTokens): number {
  return (
    t.colors.length + t.spacing.length + t.fontSizes.length + t.fontWeights.length +
    t.radius.length + t.shadows.length + t.lineHeights.length + t.fontFamilies.length
  );
}

/**
 * Chrome liệt kê cả custom properties (--*) trong computed style.
 * Lấy trên <html>, <body> và phần tử ở giữa viewport (biến theme thường gắn ở div gốc của app).
 */
function extractCssVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  const els: Element[] = [document.documentElement, document.body];
  const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  if (center) els.push(center);
  for (const el of els) {
    const cs = getComputedStyle(el);
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (!name.startsWith('--') || name in out) continue;
      const v = cs.getPropertyValue(name).trim();
      if (!v || v.length > 300 || /url\(/i.test(v)) continue;
      out[name] = colorsToHex(v);
    }
    if (Object.keys(out).length > 2000) break;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
