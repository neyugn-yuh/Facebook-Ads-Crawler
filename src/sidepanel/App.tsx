import { useCallback, useEffect, useRef, useState } from 'react';
import { buildZip, downloadBlob } from '../exporter/ZipExporter';
import type { Broadcast } from '../shared/messages';
import { clearAll, deleteSnapshot, getSnapshot, listSummaries } from '../shared/storage/db';
import type { CrawlerConfig, CrawlerStatus, SnapshotSummary } from '../shared/types';
import { formatBytes, loadConfig, saveConfig } from '../shared/utils';
import { SettingsPanel } from './components/SettingsPanel';
import { SnapshotItem } from './components/SnapshotItem';
import { StatusCard } from './components/StatusCard';

export function App() {
  const [tabId, setTabId] = useState<number>();
  const tabRef = useRef<number>();
  const [status, setStatus] = useState<CrawlerStatus | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [config, setConfig] = useState<CrawlerConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canCapture, setCanCapture] = useState(true);

  const refreshSnapshots = useCallback(() => void listSummaries().then(setSnapshots), []);

  const refreshTab = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setTabId(tab?.id);
    tabRef.current = tab?.id;
    if (tab?.id !== undefined) {
      const s = (await chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId: tab.id })) as CrawlerStatus | null;
      setStatus(s);
    }
  }, []);

  useEffect(() => {
    void refreshTab();
    refreshSnapshots();
    void loadConfig().then(setConfig);
    void chrome.permissions.contains({ origins: ['<all_urls>'] }).then(setCanCapture);

    const onMsg = (msg: Broadcast) => {
      if (msg.type === 'SNAPSHOTS_CHANGED') refreshSnapshots();
      if (msg.type === 'STATUS_UPDATED' && msg.status.tabId === tabRef.current) setStatus(msg.status);
    };
    const onActivated = () => void refreshTab();
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.tabs.onActivated.addListener(onActivated);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, [refreshTab, refreshSnapshots]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const crawlNow = async () => {
    if (tabId === undefined) return;
    setBusy('crawl');
    const res = (await chrome.runtime.sendMessage({ type: 'CRAWL_TAB', tabId })) as { ok: boolean; error?: string };
    setBusy(null);
    if (!res?.ok) flash(res?.error ?? 'Không crawl được tab này');
  };

  const exportZip = async (ids?: string[]) => {
    setBusy('export');
    try {
      const { blob, filename, pages } = await buildZip(ids);
      await downloadBlob(blob, filename);
      flash(`Đã export ${pages} snapshot (${formatBytes(blob.size)})`);
    } catch (e) {
      flash(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const exportJson = async (id: string) => {
    const s = await getSnapshot(id);
    if (!s) return;
    await downloadBlob(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }), `${id}.snapshot.json`);
  };

  const remove = async (id: string) => {
    await deleteSnapshot(id);
    refreshSnapshots();
  };

  const removeAll = async () => {
    if (!confirm('Xoá toàn bộ snapshot đã lưu?')) return;
    await clearAll();
    refreshSnapshots();
  };

  const grantCapture = async () => {
    // Chrome chỉ cho captureVisibleTab khi có <all_urls> hoặc activeTab → xin quyền tuỳ chọn 1 lần
    const ok = await chrome.permissions.request({ origins: ['<all_urls>'] });
    setCanCapture(ok);
    if (ok) flash('Đã cấp quyền. Bấm “Crawl ngay” để chụp lại screenshot.');
  };

  const updateConfig = async (patch: Partial<CrawlerConfig>) => setConfig(await saveConfig(patch));

  const totalComponents = snapshots.reduce((a, s) => a + s.stats.components, 0);
  const routes = new Set(snapshots.map((s) => s.route)).size;

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">▦</div>
        <div>
          <h1>UI Auto Crawler</h1>
          <p className="muted">Crawl giao diện Ads Manager để dựng lại UI</p>
        </div>
      </header>

      {!canCapture && config?.captureScreenshot && (
        <div className="card perm">
          <b>Screenshot tự động cần thêm quyền</b>
          <p className="small muted">
            Chrome chỉ cho phép chụp tab khi extension có quyền trên mọi trang (hoặc bạn vừa bấm icon extension trên tab đó).
            Extension vẫn chỉ tự chạy trên Facebook; quyền này chỉ dùng cho <code>captureVisibleTab</code>.
          </p>
          <button className="btn primary" onClick={grantCapture}>
            Cấp quyền screenshot
          </button>
        </div>
      )}

      <StatusCard status={status} />

      <div className="actions">
        <button className="btn primary" onClick={crawlNow} disabled={busy !== null || tabId === undefined}>
          {busy === 'crawl' ? 'Đang gửi…' : 'Crawl ngay'}
        </button>
        <button className="btn" onClick={() => exportZip()} disabled={busy !== null || !snapshots.length}>
          {busy === 'export' ? 'Đang nén…' : 'Export ZIP'}
        </button>
      </div>
      {config && (
        <label className="switch-row">
          <input type="checkbox" checked={config.autoStart} onChange={(e) => updateConfig({ autoStart: e.target.checked })} />
          <span>Tự crawl khi mở Ads Manager</span>
        </label>
      )}
      {notice && <div className="notice">{notice}</div>}

      <section>
        <div className="section-head">
          <h2>Snapshots</h2>
          <span className="muted">
            {routes} route · {snapshots.length} snapshot · {totalComponents.toLocaleString()} component
          </span>
        </div>
        {!snapshots.length && <p className="empty">Chưa có snapshot. Mở Ads Manager hoặc bấm “Crawl ngay”.</p>}
        <ul className="snap-list">
          {snapshots.map((s) => (
            <SnapshotItem
              key={s.id + s.timestamp}
              snap={s}
              onView={() => chrome.tabs.create({ url: chrome.runtime.getURL(`viewer/index.html?id=${encodeURIComponent(s.id)}`) })}
              onJson={() => exportJson(s.id)}
              onZip={() => exportZip([s.id])}
              onDelete={() => remove(s.id)}
            />
          ))}
        </ul>
        {snapshots.length > 0 && (
          <button className="btn danger ghost" onClick={removeAll}>
            Xoá tất cả
          </button>
        )}
      </section>

      {config && <SettingsPanel config={config} onChange={updateConfig} />}

      <footer className="muted small">
        Dữ liệu chỉ lưu trên máy (IndexedDB). Không đọc cookie/token, không gửi đi đâu.
      </footer>
    </div>
  );
}
