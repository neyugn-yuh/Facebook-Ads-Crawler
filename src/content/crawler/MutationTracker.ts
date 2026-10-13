// Theo dõi mutation sau khi đã có snapshot, gom các element bị ảnh hưởng (debounce),
// rồi giao cho Crawler để crawl lại subtree (incremental) thay vì cả trang.

const RELEVANT_ATTRS = new Set([
  'class', 'style', 'hidden', 'role', 'open', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-hidden',
  'aria-pressed', 'aria-disabled', 'aria-label', 'disabled', 'src', 'placeholder',
]);

export type MutationBatchHandler = (affected: Set<Element>) => void;

export class MutationTracker {
  private observer: MutationObserver | null = null;
  private pending = new Set<Element>();
  private timer: number | undefined;
  private paused = false;

  constructor(private debounceMs: number, private onBatch: MutationBatchHandler, private onAny?: () => void) {}

  start() {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => this.collect(records));
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...RELEVANT_ATTRS],
      characterData: true,
    });
  }

  stop() {
    this.observer?.disconnect();
    this.observer = null;
    clearTimeout(this.timer);
    this.pending.clear();
  }

  /** Tạm dừng thu thập (khi đang full crawl). */
  setPaused(p: boolean) {
    this.paused = p;
    if (p) {
      clearTimeout(this.timer);
      this.pending.clear();
    }
  }

  private collect(records: MutationRecord[]) {
    this.onAny?.();
    if (this.paused) return;
    for (const r of records) {
      const target = r.type === 'characterData' ? r.target.parentElement : (r.target as Element);
      if (target && target.nodeType === Node.ELEMENT_NODE) this.pending.add(target);
    }
    if (!this.pending.size) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush() {
    const batch = this.pending;
    this.pending = new Set();
    if (batch.size) this.onBatch(batch);
  }
}
