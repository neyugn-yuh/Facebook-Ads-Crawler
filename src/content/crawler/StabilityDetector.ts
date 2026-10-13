// Đợi SPA render ổn định: không có DOM mutation trong `quietPeriod` ms (hoặc hết timeout).

export interface StableOptions {
  quietPeriod: number;
  timeout: number;
  signal?: AbortSignal;
}

export interface StableResult {
  stable: boolean;
  waitedMs: number;
}

export function waitForDocumentReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
}

/** Tab ẩn thì không render/chụp được → đợi tới khi tab hiển thị. */
export function waitForVisible(signal?: AbortSignal): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onChange = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onChange);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', onChange);
    signal?.addEventListener('abort', () => {
      document.removeEventListener('visibilitychange', onChange);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export async function waitForStableDOM({ quietPeriod, timeout, signal }: StableOptions): Promise<StableResult> {
  await waitForDocumentReady();
  const start = performance.now();

  const result = await new Promise<StableResult>((resolve, reject) => {
    let quietTimer: number | undefined;
    let done = false;

    const finish = (stable: boolean) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      resolve({ stable, waitedMs: Math.round(performance.now() - start) });
    };

    const armQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => {
        // Phải có nội dung render trong viewport mới tính là xong
        if (hasRenderedContent()) finish(true);
        else armQuiet();
      }, quietPeriod);
    };

    const observer = new MutationObserver(() => armQuiet());
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    const hardTimer = window.setTimeout(() => finish(false), timeout);
    signal?.addEventListener('abort', () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      reject(new DOMException('aborted', 'AbortError'));
    });
    armQuiet();
  });

  // Đợi 2 frame để layout/paint cuối cùng hoàn tất
  await nextFrame();
  await nextFrame();
  return result;
}

function hasRenderedContent(): boolean {
  const body = document.body;
  if (!body || body.childElementCount === 0) return false;
  const r = body.getBoundingClientRect();
  if (r.height < 10 && document.documentElement.scrollHeight < 10) return false;
  // Có phần tử thực sự ở giữa viewport
  const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  return !!center && center !== document.documentElement;
}
