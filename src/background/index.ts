// Service worker: chụp screenshot, lưu snapshot vào IndexedDB, giữ trạng thái crawler theo tab,
// broadcast cho side panel. Không có network request nào ra ngoài.
import type { Broadcast, CaptureResult, SaveResult, ToBackground } from '../shared/messages';
import { countStatesForRoute, getSnapshot, putSnapshot } from '../shared/storage/db';
import type { CrawlerStatus } from '../shared/types';
import { loadConfig, sleep } from '../shared/utils';

const pendingShots = new Map<number, Blob>();
let lastCaptureAt = 0;
let captureChain: Promise<unknown> = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// ─── Status (lưu ở storage.session để sống sót khi service worker bị tắt) ─────

async function getStatuses(): Promise<Record<string, CrawlerStatus>> {
  const d = await chrome.storage.session.get('statuses');
  return (d.statuses as Record<string, CrawlerStatus>) ?? {};
}

let statusChain: Promise<unknown> = Promise.resolve();
function setStatus(tabId: number, status: CrawlerStatus) {
  // Tuần tự hoá read-modify-write để các tab không ghi đè nhau
  statusChain = statusChain.then(async () => {
    const all = await getStatuses();
    all[tabId] = status;
    await chrome.storage.session.set({ statuses: all });
  }).catch(() => {});
  return statusChain;
}

function broadcast(msg: Broadcast) {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* side panel chưa mở */
  });
}

const BADGE: Partial<Record<CrawlerStatus['phase'], [string, string]>> = {
  waiting: ['…', '#8A8D91'],
  crawling: ['●', '#1877F2'],
  analyzing: ['●', '#1877F2'],
  saving: ['●', '#1877F2'],
  watching: ['✓', '#31A24C'],
  completed: ['✓', '#31A24C'],
  error: ['!', '#E41E3F'],
};

function updateBadge(tabId: number, phase: CrawlerStatus['phase']) {
  const b = BADGE[phase];
  void chrome.action.setBadgeText({ tabId, text: b ? b[0] : '' }).catch(() => {});
  if (b) void chrome.action.setBadgeBackgroundColor({ tabId, color: b[1] }).catch(() => {});
}

// ─── Screenshot ─────────────────────────────────────────────────────────────

async function capture(tabId: number, windowId: number): Promise<CaptureResult> {
  // Chrome giới hạn ~2 lần captureVisibleTab / giây
  const wait = 600 - (Date.now() - lastCaptureAt);
  if (wait > 0) await sleep(wait);
  lastCaptureAt = Date.now();

  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) return { ok: false, error: 'Tab không active nên không chụp được' };
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    const blob = await (await fetch(dataUrl)).blob();
    pendingShots.set(tabId, blob);
    return { ok: true };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/permission|activeTab|all_urls/i.test(msg)) {
      return { ok: false, error: 'Chưa có quyền chụp màn hình — mở side panel và bấm "Cấp quyền screenshot"' };
    }
    return { ok: false, error: 'Không chụp được screenshot: ' + msg };
  }
}

// ─── Lưu snapshot ───────────────────────────────────────────────────────────

async function save(tabId: number, msg: Extract<ToBackground, { type: 'SAVE_SNAPSHOT' }>): Promise<SaveResult> {
  const { snapshot } = msg;
  const cfg = await loadConfig();
  const existing = await getSnapshot(snapshot.id);

  if (!existing && snapshot.state !== 'base') {
    const count = await countStatesForRoute(snapshot.route);
    if (count >= cfg.maxStatesPerRoute) {
      return { ok: false, hasScreenshot: false, error: `Route đã đủ ${cfg.maxStatesPerRoute} state, bỏ qua "${snapshot.state}"` };
    }
  }

  const shot = msg.useCapturedScreenshot ? pendingShots.get(tabId) ?? null : null;
  pendingShots.delete(tabId);
  if (shot) {
    snapshot.hasScreenshot = true;
    snapshot.screenshotAt = snapshot.timestamp;
  } else if (existing?.hasScreenshot) {
    // Incremental update: giữ screenshot cũ
    snapshot.hasScreenshot = true;
    snapshot.screenshotAt = existing.screenshotAt;
  } else if (!msg.useCapturedScreenshot && existing?.screenshotError && !snapshot.screenshotError) {
    snapshot.screenshotError = existing.screenshotError;
  }

  await putSnapshot(snapshot, shot);
  broadcast({ type: 'SNAPSHOTS_CHANGED' });
  return { ok: true, hasScreenshot: snapshot.hasScreenshot };
}

// ─── Crawl thủ công từ side panel ───────────────────────────────────────────

async function ping(tabId: number): Promise<boolean> {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return !!r?.ok;
  } catch {
    return false;
  }
}

async function crawlTab(tabId: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await ping(tabId))) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch (e) {
      return { ok: false, error: 'Không inject được content script vào trang này: ' + String((e as Error)?.message ?? e) };
    }
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
      await sleep(100);
      ready = await ping(tabId);
    }
    if (!ready) return { ok: false, error: 'Content script không phản hồi' };
  }
  await chrome.tabs.sendMessage(tabId, { type: 'CRAWL_NOW' });
  return { ok: true };
}

// ─── Router ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const run = async (): Promise<unknown> => {
    switch (msg.type) {
      case 'STATUS': {
        if (tabId === undefined) return;
        const status: CrawlerStatus = { ...msg.status, tabId, updatedAt: Date.now() };
        await setStatus(tabId, status);
        updateBadge(tabId, status.phase);
        broadcast({ type: 'STATUS_UPDATED', status });
        return { ok: true };
      }
      case 'CAPTURE_SCREENSHOT': {
        if (tabId === undefined || sender.tab?.windowId === undefined) return { ok: false, error: 'no tab' };
        const job = captureChain.then(() => capture(tabId, sender.tab!.windowId));
        captureChain = job.catch(() => {});
        return job;
      }
      case 'SAVE_SNAPSHOT':
        if (tabId === undefined) return { ok: false, hasScreenshot: false, error: 'no tab' };
        return save(tabId, msg);
      case 'GET_STATUS': {
        const all = await getStatuses();
        return msg.tabId !== undefined ? all[msg.tabId] ?? null : null;
      }
      case 'CRAWL_TAB':
        return crawlTab(msg.tabId);
    }
  };
  run()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingShots.delete(tabId);
  statusChain = statusChain.then(async () => {
    const all = await getStatuses();
    delete all[tabId];
    await chrome.storage.session.set({ statuses: all });
  }).catch(() => {});
});
