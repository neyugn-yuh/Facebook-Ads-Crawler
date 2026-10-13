import type { CrawlerConfig } from '../types';

export const CRAWLER_VERSION = '0.1.0';

export const DEFAULT_CONFIG: CrawlerConfig = {
  autoStart: true,
  waitForStableMs: 1000,
  stableTimeoutMs: 15000,
  mutationDebounceMs: 300,
  maxDepth: 60,
  maxNodes: 10000,
  maxTextLength: 100,
  captureScreenshot: true,
  extractText: true,
  extractAssets: true,
  extractStyles: true,
  detectComponents: true,
  sanitizeDynamicData: true,
  collapseWrappers: true,
  trackMutations: true,
  maxStatesPerRoute: 150,
  redactTerms: [],
  targetUrlPatterns: [
    '^https://adsmanager\\.facebook\\.com/',
    '^https://(www|business|web)\\.facebook\\.com/adsmanager',
  ],
};

export const STORAGE_KEYS = {
  config: 'uiCrawlerConfig',
} as const;

/** Event do route-hook.js (MAIN world) phát ra khi history thay đổi. */
export const LOCATION_CHANGE_EVENT = '__ui_crawler_locationchange__';

/** Các tag không bao giờ crawl. */
export const IGNORED_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'frame', 'template', 'link', 'meta', 'head', 'object', 'embed', 'source', 'track', 'br', 'wbr',
]);

/** Không đi sâu vào con của các tag này (svg giữ nguyên là 1 node icon). */
export const LEAF_TAGS = new Set(['svg', 'img', 'input', 'textarea', 'select', 'video', 'canvas', 'audio', 'picture', 'math']);

/** Thuộc tính HTML được giữ lại (đều được sanitize). Không giữ class (Facebook dùng atomic class bị obfuscate). */
export const KEPT_ATTRIBUTES = [
  'role', 'type', 'aria-label', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-pressed',
  'aria-disabled', 'aria-haspopup', 'aria-level', 'aria-sort', 'aria-current', 'aria-modal', 'aria-orientation',
  'placeholder', 'alt', 'title', 'href', 'disabled', 'data-testid', 'colspan', 'rowspan', 'for',
];

/**
 * CSS properties được trích xuất. Chia theo nhóm để quyết định khi nào lưu.
 * Các property "inherited" chỉ lưu khi khác node cha → giảm kích thước rất nhiều.
 */
export const INHERITED_PROPS = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'white-space', 'cursor', 'visibility', 'word-break',
];

export const LAYOUT_PROPS = [
  'display', 'position', 'box-sizing',
  'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'padding', 'gap', 'row-gap', 'column-gap',
  'top', 'right', 'bottom', 'left', 'z-index',
  'overflow', 'transform',
];

export const FLEX_CONTAINER_PROPS = ['flex-direction', 'justify-content', 'align-items', 'align-content', 'flex-wrap'];
export const FLEX_ITEM_PROPS = ['flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'order'];
export const GRID_CONTAINER_PROPS = ['grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'justify-items', 'align-items', 'justify-content', 'align-content'];
export const GRID_ITEM_PROPS = ['grid-column', 'grid-row', 'align-self', 'justify-self'];

export const VISUAL_PROPS = [
  'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat',
  'border-width', 'border-style', 'border-color', 'border-radius',
  'outline-style', 'outline-width', 'outline-color',
  'box-shadow', 'opacity', 'text-overflow', 'text-decoration-line', 'vertical-align', 'fill', 'stroke',
  'transition-property', 'transition-duration',
];

/** Giá trị mặc định → không lưu. */
export const DEFAULT_VALUES: Record<string, string[]> = {
  position: ['static'],
  'box-sizing': ['content-box'],
  'min-width': ['0px', 'auto'],
  'min-height': ['0px', 'auto'],
  'max-width': ['none'],
  'max-height': ['none'],
  margin: ['0px'],
  padding: ['0px'],
  gap: ['normal', 'normal normal'],
  'row-gap': ['normal'],
  'column-gap': ['normal'],
  top: ['auto'], right: ['auto'], bottom: ['auto'], left: ['auto'],
  'z-index': ['auto'],
  overflow: ['visible', 'visible visible'],
  transform: ['none'],
  'flex-direction': ['row'],
  'justify-content': ['normal', 'flex-start'],
  'align-items': ['normal'],
  'align-content': ['normal'],
  'flex-wrap': ['nowrap'],
  'flex-grow': ['0'],
  'flex-shrink': ['1'],
  'flex-basis': ['auto'],
  'align-self': ['auto'],
  'justify-self': ['auto'],
  'justify-items': ['normal', 'legacy'],
  order: ['0'],
  'grid-column': ['auto', 'auto / auto'],
  'grid-row': ['auto', 'auto / auto'],
  'grid-template-columns': ['none'],
  'grid-template-rows': ['none'],
  'grid-auto-flow': ['row'],
  'background-color': ['rgba(0, 0, 0, 0)', 'transparent'],
  'background-image': ['none'],
  'background-position': ['0% 0%'],
  'background-size': ['auto', 'auto auto'],
  'background-repeat': ['repeat'],
  'border-width': ['0px'],
  'border-style': ['none'],
  'border-radius': ['0px'],
  'outline-style': ['none'],
  'box-shadow': ['none'],
  opacity: ['1'],
  'text-overflow': ['clip'],
  'text-decoration-line': ['none'],
  'vertical-align': ['baseline'],
  fill: ['rgb(0, 0, 0)'],
  stroke: ['none'],
  'transition-property': ['all', 'none'],
  'transition-duration': ['0s'],
  cursor: ['auto'],
  visibility: ['visible'],
  'word-break': ['normal'],
  'font-style': ['normal'],
};

/** Các role được coi là "overlay state" → tạo snapshot state riêng khi xuất hiện. */
export const OVERLAY_ROLES = ['dialog', 'alertdialog', 'menu', 'listbox'];
