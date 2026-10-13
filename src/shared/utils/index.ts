import { DEFAULT_CONFIG, STORAGE_KEYS } from '../constants';
import type { CrawlerConfig } from '../types';

/** FNV-1a 32-bit → base36. Đủ tốt cho signature component. */
export function hash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function slugify(input: string, max = 60): string {
  const s = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'page';
}

const RGB_RE = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

/** rgb()/rgba() → #rrggbb / #rrggbbaa. Giá trị khác giữ nguyên. */
export function toHex(color: string): string {
  const m = RGB_RE.exec(color.trim());
  if (!m) return color;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(parseFloat(v)))));
  let hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  if (m[4] !== undefined) {
    const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 1) hex += Math.round(a * 255).toString(16).padStart(2, '0');
  }
  return hex.toUpperCase();
}

/** Đổi mọi rgb()/rgba() trong 1 chuỗi (vd box-shadow, border-color nhiều cạnh) sang hex. */
export function colorsToHex(value: string): string {
  return value.replace(/rgba?\([^)]*\)/gi, (c) => toHex(c));
}

export function isTransparent(color: string | undefined): boolean {
  if (!color) return true;
  return color === 'transparent' || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(color) || /^#[0-9A-F]{6}00$/i.test(color);
}

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function loadConfig(): Promise<CrawlerConfig> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.config);
    return { ...DEFAULT_CONFIG, ...(data[STORAGE_KEYS.config] ?? {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: Partial<CrawlerConfig>): Promise<CrawlerConfig> {
  const current = await loadConfig();
  const next = { ...current, ...config };
  await chrome.storage.local.set({ [STORAGE_KEYS.config]: next });
  return next;
}

export function isTargetUrl(url: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    try {
      return new RegExp(p).test(url);
    } catch {
      return false;
    }
  });
}

/** Chuẩn hoá pathname thành route: thay các đoạn số (ID) bằng :id. */
export function routeFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .split('/')
      .map((seg) => (/^\d{3,}$/.test(seg) ? ':id' : seg))
      .join('/')
      .replace(/\/+$/, '');
    return path || '/';
  } catch {
    return '/';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
