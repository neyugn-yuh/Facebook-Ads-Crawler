// Trích xuất computed CSS. Chỉ lưu giá trị khác mặc định, và property kế thừa chỉ lưu khi khác cha.
import {
  DEFAULT_VALUES, FLEX_CONTAINER_PROPS, FLEX_ITEM_PROPS, GRID_CONTAINER_PROPS, GRID_ITEM_PROPS,
  INHERITED_PROPS, LAYOUT_PROPS, VISUAL_PROPS,
} from '../../shared/constants';
import type { UIStyles } from '../../shared/types';
import { colorsToHex } from '../../shared/utils';

export interface StyleResult {
  styles: UIStyles;
  /** Giá trị đầy đủ của các property kế thừa (để so sánh với con). */
  inherited: Record<string, string>;
  display: string;
}

const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'polygon', 'line', 'polyline', 'ellipse', 'use']);

function isDefault(prop: string, value: string): boolean {
  const d = DEFAULT_VALUES[prop];
  return !value || (d !== undefined && d.includes(value));
}

export function extractStyles(
  tag: string,
  cs: CSSStyleDeclaration,
  parentInherited: Record<string, string> | null,
  parentDisplay: string,
  onBackgroundUrl?: (url: string) => void,
): StyleResult {
  const styles: UIStyles = {};
  const inherited: Record<string, string> = {};
  const get = (p: string) => cs.getPropertyValue(p);

  // Kế thừa: chỉ lưu khi khác cha (root lưu toàn bộ)
  for (const p of INHERITED_PROPS) {
    const v = get(p);
    inherited[p] = v;
    if (parentInherited ? parentInherited[p] !== v : !isDefault(p, v)) styles[p] = v;
  }

  const display = get('display');
  styles.display = display;
  const position = get('position');

  for (const p of LAYOUT_PROPS) {
    if (p === 'display') continue;
    if ((p === 'top' || p === 'right' || p === 'bottom' || p === 'left' || p === 'z-index') && position === 'static') continue;
    const v = get(p);
    if (!isDefault(p, v)) styles[p] = v;
  }

  const isFlex = display.includes('flex');
  const isGrid = display.includes('grid');
  if (isFlex) for (const p of FLEX_CONTAINER_PROPS) addIfSet(styles, p, get(p));
  if (isGrid) for (const p of GRID_CONTAINER_PROPS) addIfSet(styles, p, get(p));
  if (parentDisplay.includes('flex')) for (const p of FLEX_ITEM_PROPS) addIfSet(styles, p, get(p));
  if (parentDisplay.includes('grid')) for (const p of GRID_ITEM_PROPS) addIfSet(styles, p, get(p));
  if (!isFlex && !isGrid) {
    delete styles.gap;
    delete styles['row-gap'];
    delete styles['column-gap'];
  }

  const isSvg = SVG_TAGS.has(tag);
  const hasBorder = get('border-width') !== '0px' && get('border-style') !== 'none';
  const hasOutline = get('outline-style') !== 'none';
  const hasTransition = get('transition-duration') !== '0s';

  for (const p of VISUAL_PROPS) {
    if ((p === 'fill' || p === 'stroke') && !isSvg) continue;
    if (p.startsWith('border-') && p !== 'border-radius' && !hasBorder) continue;
    if (p.startsWith('outline-') && !hasOutline) continue;
    if (p.startsWith('transition-') && !hasTransition) continue;
    if (p === 'text-overflow' && styles.overflow === undefined) continue;
    let v = get(p);
    if (isDefault(p, v)) continue;
    if (p === 'background-image') {
      v = v.replace(/url\((['"]?)(.*?)\1\)/g, (_m, _q, url: string) => {
        onBackgroundUrl?.(url);
        return 'url(<ASSET>)';
      });
    }
    if ((p === 'background-position' || p === 'background-size' || p === 'background-repeat') && !styles['background-image']) continue;
    styles[p] = v;
  }

  for (const k of Object.keys(styles)) styles[k] = colorsToHex(styles[k]);
  return { styles, inherited, display };
}

function addIfSet(styles: UIStyles, p: string, v: string) {
  if (!isDefault(p, v)) styles[p] = v;
}

/** Bảng style dùng chung — nhiều node cùng style chỉ lưu 1 lần. */
export class StyleTable {
  private byKey = new Map<string, string>();
  readonly styles: Record<string, UIStyles> = {};
  private counter = 0;

  add(styles: UIStyles): string {
    const key = Object.keys(styles).sort().map((k) => `${k}:${styles[k]}`).join(';');
    let id = this.byKey.get(key);
    if (!id) {
      id = 's' + (this.counter++).toString(36);
      this.byKey.set(key, id);
      this.styles[id] = styles;
    }
    return id;
  }

  get(id: string | undefined): UIStyles {
    return (id && this.styles[id]) || {};
  }
}
