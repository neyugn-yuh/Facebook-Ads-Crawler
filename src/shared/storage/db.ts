// IndexedDB dùng chung cho background + side panel + viewer (cùng origin chrome-extension://).
// Snapshot có thể vài MB và screenshot là Blob → không phù hợp chrome.storage.
import type { PageSnapshot, SnapshotSummary } from '../types';

const DB_NAME = 'ui-auto-crawler';
const DB_VERSION = 1;
const SNAPSHOTS = 'snapshots';
const SCREENSHOTS = 'screenshots';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SCREENSHOTS)) db.createObjectStore(SCREENSHOTS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let result: T;
        const req = fn(t);
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export function putSnapshot(snapshot: PageSnapshot, screenshot?: Blob | null): Promise<void> {
  return tx<void>([SNAPSHOTS, SCREENSHOTS], 'readwrite', (t) => {
    t.objectStore(SNAPSHOTS).put(snapshot);
    if (screenshot) t.objectStore(SCREENSHOTS).put(screenshot, snapshot.id);
  });
}

export function getSnapshot(id: string): Promise<PageSnapshot | undefined> {
  return tx<PageSnapshot | undefined>([SNAPSHOTS], 'readonly', (t) => t.objectStore(SNAPSHOTS).get(id));
}

export function getScreenshot(id: string): Promise<Blob | undefined> {
  return tx<Blob | undefined>([SCREENSHOTS], 'readonly', (t) => t.objectStore(SCREENSHOTS).get(id));
}

export function getAllSnapshots(): Promise<PageSnapshot[]> {
  return tx<PageSnapshot[]>([SNAPSHOTS], 'readonly', (t) => t.objectStore(SNAPSHOTS).getAll());
}

export async function listSummaries(): Promise<SnapshotSummary[]> {
  const all = await getAllSnapshots();
  return all
    .map(({ id, route, state, title, url, timestamp, stats, hasScreenshot, screenshotError }) => ({
      id, route, state, title, url, timestamp, stats, hasScreenshot, screenshotError,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function deleteSnapshot(id: string): Promise<void> {
  return tx<void>([SNAPSHOTS, SCREENSHOTS], 'readwrite', (t) => {
    t.objectStore(SNAPSHOTS).delete(id);
    t.objectStore(SCREENSHOTS).delete(id);
  });
}

export function clearAll(): Promise<void> {
  return tx<void>([SNAPSHOTS, SCREENSHOTS], 'readwrite', (t) => {
    t.objectStore(SNAPSHOTS).clear();
    t.objectStore(SCREENSHOTS).clear();
  });
}

export async function countStatesForRoute(route: string): Promise<number> {
  const all = await listSummaries();
  return all.filter((s) => s.route === route).length;
}
