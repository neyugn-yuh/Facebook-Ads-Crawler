// Content script: tự khởi động crawler khi vào trang Ads Manager.
import type { ToContent } from '../shared/messages';
import { STORAGE_KEYS } from '../shared/constants';
import { loadConfig } from '../shared/utils';
import { Crawler } from './crawler/Crawler';

declare global {
  interface Window {
    __uiAutoCrawler?: Crawler;
  }
}

async function main() {
  // Tránh khởi tạo 2 lần (manifest inject + inject thủ công từ side panel)
  if (window.__uiAutoCrawler || window.top !== window) return;
  const cfg = await loadConfig();
  const crawler = new Crawler(cfg);
  window.__uiAutoCrawler = crawler;

  chrome.runtime.onMessage.addListener((msg: ToContent, _sender, sendResponse) => {
    if (msg.type === 'PING') sendResponse({ ok: true });
    if (msg.type === 'CRAWL_NOW') {
      crawler.crawlNow();
      sendResponse({ ok: true });
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.config]) void loadConfig().then((c) => crawler.updateConfig(c));
  });

  crawler.start();
}

void main();
