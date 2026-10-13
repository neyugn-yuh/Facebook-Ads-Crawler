import type { CrawlerStatus, PageSnapshot } from './types';

/** content script / side panel → background */
export type ToBackground =
  | { type: 'STATUS'; status: Omit<CrawlerStatus, 'tabId' | 'updatedAt'> }
  /** Background chụp tab hiện tại và giữ ảnh tạm cho lần SAVE_SNAPSHOT kế tiếp. */
  | { type: 'CAPTURE_SCREENSHOT' }
  | { type: 'SAVE_SNAPSHOT'; snapshot: PageSnapshot; useCapturedScreenshot: boolean }
  | { type: 'GET_STATUS'; tabId?: number }
  | { type: 'CRAWL_TAB'; tabId: number };

/** background → content script */
export type ToContent = { type: 'CRAWL_NOW' } | { type: 'PING' };

/** background → side panel (broadcast) */
export type Broadcast =
  | { type: 'STATUS_UPDATED'; status: CrawlerStatus }
  | { type: 'SNAPSHOTS_CHANGED' };

export interface CaptureResult {
  ok: boolean;
  error?: string;
}

export interface SaveResult {
  ok: boolean;
  hasScreenshot: boolean;
  error?: string;
}
