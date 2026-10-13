// Chỉ lưu metadata của ảnh/SVG/background-image. Không tải file, không lưu URL đầy đủ.
import type { AssetInfo } from '../../shared/types';
import { toHex } from '../../shared/utils';

function host(url: string): string | undefined {
  if (!url || url.startsWith('data:')) return url ? 'data-uri' : undefined;
  try {
    return new URL(url, location.href).host;
  } catch {
    return undefined;
  }
}

export function detectAsset(
  el: Element,
  cs: CSSStyleDeclaration,
  rect: DOMRect,
  nodeId: string,
  backgroundUrl: string | null,
  sanitizeAlt: (v: string) => string,
): AssetInfo | null {
  const tag = el.localName;
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  if (tag === 'img') {
    const img = el as HTMLImageElement;
    const alt = img.getAttribute('alt');
    return {
      nodeId, type: 'image', width, height,
      naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
      host: host(img.currentSrc || img.src),
      ...(alt ? { alt: sanitizeAlt(alt) } : {}),
    };
  }

  if (tag === 'svg') {
    const fill = cs.getPropertyValue('fill');
    const color = cs.getPropertyValue('color');
    return {
      nodeId, type: 'svg', width, height,
      viewBox: el.getAttribute('viewBox') ?? undefined,
      fill: toHex(fill === 'currentcolor' || fill === 'currentColor' ? color : fill),
      pathCount: el.querySelectorAll('path, circle, rect, polygon, line, polyline, ellipse, use').length,
    };
  }

  if (backgroundUrl) {
    const pos = cs.getPropertyValue('background-position');
    return {
      nodeId, type: 'background-image', width, height,
      host: host(backgroundUrl),
      backgroundPosition: pos,
      backgroundSize: cs.getPropertyValue('background-size'),
      sprite: pos !== '0% 0%' && pos !== '0px 0px' && width <= 64 && height <= 64,
    };
  }

  return null;
}
