// Loại bỏ dữ liệu động/nhạy cảm khỏi text & attribute, giữ lại "hình dạng" UI.
//
// 2 tầng:
//  1. Pattern: email, URL, tiền tệ, %, ngày giờ, ID, số lớn → placeholder (<CURRENCY>, <ID>...).
//  2. Vùng dữ liệu (ô trong bảng/grid): text bị thay bằng <TEXT:n> (n = số ký tự, giữ độ dài cho layout),
//     trừ các nhãn ngắn lặp lại nhiều lần (vd "Active", "Learning") vì đó là nhãn UI chứ không phải dữ liệu.
import type { CrawlerConfig, UINode } from '../../shared/types';

const PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<EMAIL>'],
  [/\bhttps?:\/\/[^\s"'<>]+/gi, '<URL>'],
  [/\bwww\.[^\s"'<>]+/gi, '<URL>'],
  // Tiền tệ: ký hiệu trước hoặc sau số
  [/(?:US\$|[$€£¥₫₩₹฿]|\b(?:USD|VND|EUR|GBP|JPY|THB|SGD|AUD|CAD)\s?)\s?-?\d(?:[\d.,]|\s(?=\d))*(?:\s?[KMBkmb]\b)?/g, '<CURRENCY>'],
  [/-?\d(?:[\d.,]|\s(?=\d))*\s?(?:₫|đ(?![a-zà-ỹ])|\$|€|£|\b(?:USD|VND|EUR|GBP|THB)\b)/gi, '<CURRENCY>'],
  [/[-+]?\d[\d.,]*\s?%/g, '<PERCENT>'],
  // Ngày
  [/\b\d{4}-\d{1,2}-\d{1,2}\b/g, '<DATE>'],
  [/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, '<DATE>'],
  [/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s\d{1,2}(?:,?\s\d{4})?\b/gi, '<DATE>'],
  [/\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?(?:,?\s\d{4})?\b/gi, '<DATE>'],
  [/\b\d{1,2}\s(?:thg|tháng)\s\d{1,2}(?:,?\s\d{4})?/gi, '<DATE>'],
  // Giờ
  [/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|SA|CH)?\b/gi, '<TIME>'],
  // ID dài (account id, campaign id...)
  [/\b\d{6,}\b/g, '<ID>'],
  // Số: có phân cách hàng nghìn, thập phân, hoặc ≥ 3 chữ số. Giữ số 1–2 chữ số (vd "Last 7 days").
  [/\b\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?\b/g, '<NUMBER>'],
  [/\b\d+[.,]\d+\b/g, '<NUMBER>'],
  [/\b\d{3,}\b/g, '<NUMBER>'],
];

const ONLY_PLACEHOLDERS = /^(?:\s|<[A-Z]+(?::\d+)?>|[()\-–—/·|:,.+])*$/;

export interface TextContext {
  dataRegion: boolean;
}

export class DataSanitizer {
  private redact: RegExp | null;
  /** Text gốc (đã qua pattern) của node trong vùng dữ liệu — chỉ nằm trong bộ nhớ, không bao giờ export. */
  private pendingData = new WeakMap<UINode, string>();

  constructor(private cfg: CrawlerConfig) {
    const terms = cfg.redactTerms.map((t) => t.trim()).filter(Boolean);
    this.redact = terms.length
      ? new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
      : null;
  }

  get enabled(): boolean {
    return this.cfg.sanitizeDynamicData;
  }

  applyPatterns(text: string): string {
    let out = text;
    if (this.redact) out = out.replace(this.redact, '<REDACTED>');
    if (!this.cfg.sanitizeDynamicData) return out;
    for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
    return out;
  }

  truncate(text: string): string {
    const max = this.cfg.maxTextLength;
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  /** Text của node. Với vùng dữ liệu, ghi nhận để quyết định ở bước finalize(). */
  text(node: UINode, raw: string, ctx: TextContext): string {
    const patterned = this.truncate(this.applyPatterns(raw));
    if (this.cfg.sanitizeDynamicData && ctx.dataRegion && !ONLY_PLACEHOLDERS.test(patterned)) {
      this.pendingData.set(node, patterned);
      return placeholder(patterned);
    }
    return patterned;
  }

  attr(name: string, value: string, ctx: TextContext): string | null {
    if (name === 'href') return sanitizeHref(value);
    if (['aria-label', 'placeholder', 'alt', 'title'].includes(name)) {
      const v = this.truncate(this.applyPatterns(value.replace(/\s+/g, ' ').trim()));
      if (this.cfg.sanitizeDynamicData && ctx.dataRegion && !ONLY_PLACEHOLDERS.test(v)) return placeholder(v);
      return v;
    }
    return value.length > 200 ? value.slice(0, 200) : value;
  }

  /**
   * Sau khi crawl xong: nhãn ngắn xuất hiện ≥ 3 lần trong vùng dữ liệu (vd "Active", "Off")
   * là nhãn UI → giữ nguyên. Các text khác giữ placeholder <TEXT:n>.
   */
  finalize(root: UINode): void {
    if (!this.cfg.sanitizeDynamicData) return;
    const freq = new Map<string, number>();
    const nodes: Array<[UINode, string]> = [];
    walk(root, (n) => {
      const raw = this.pendingData.get(n);
      if (raw !== undefined) {
        nodes.push([n, raw]);
        freq.set(raw, (freq.get(raw) ?? 0) + 1);
      }
    });
    for (const [n, raw] of nodes) {
      const isLabel = (freq.get(raw) ?? 0) >= 3 && raw.length <= 24 && !/\d/.test(raw);
      n.text = isLabel ? raw : placeholder(raw);
    }
  }
}

function placeholder(text: string): string {
  return `<TEXT:${text.length}>`;
}

function sanitizeHref(href: string): string {
  if (href.startsWith('#') || href.startsWith('javascript:')) return '#';
  try {
    const u = new URL(href, location.href);
    const path = u.pathname
      .split('/')
      .map((s) => (/\d{3,}/.test(s) ? ':id' : s))
      .join('/');
    return (u.origin === location.origin ? '' : u.origin) + path;
  } catch {
    return '#';
  }
}

function walk(node: UINode, fn: (n: UINode) => void): void {
  fn(node);
  for (const c of node.children) walk(c, fn);
}
