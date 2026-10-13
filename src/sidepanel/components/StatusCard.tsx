import type { CrawlerPhase, CrawlerStatus } from '../../shared/types';

const LABEL: Record<CrawlerPhase, string> = {
  idle: 'Chờ',
  waiting: 'Đợi UI ổn định',
  crawling: 'Đang crawl',
  analyzing: 'Đang phân tích',
  saving: 'Đang lưu',
  completed: 'Hoàn tất',
  watching: 'Hoàn tất · đang theo dõi thay đổi',
  error: 'Lỗi',
  disabled: 'Đã tắt',
};

export function StatusCard({ status }: { status: CrawlerStatus | null }) {
  if (!status) {
    return (
      <div className="card status">
        <div className="status-line">
          <span className="dot idle" /> <b>Chưa chạy trên tab này</b>
        </div>
        <p className="muted small">Mở Facebook Ads Manager để crawler tự chạy, hoặc bấm “Crawl ngay”.</p>
      </div>
    );
  }
  const active = ['waiting', 'crawling', 'analyzing', 'saving'].includes(status.phase);
  return (
    <div className="card status">
      <div className="status-line">
        <span className={`dot ${status.phase}`} /> <b>{LABEL[status.phase]}</b>
      </div>
      <dl className="grid">
        <dt>Trang</dt>
        <dd title={status.route}>{status.route ?? '—'}</dd>
        <dt>State</dt>
        <dd>{status.state ?? 'base'}</dd>
        <dt>Elements</dt>
        <dd>{status.nodes.toLocaleString()}</dd>
        <dt>Components</dt>
        <dd>{status.components.toLocaleString()}</dd>
        <dt>Tokens</dt>
        <dd>{status.tokens}</dd>
        <dt>Screenshot</dt>
        <dd>{status.screenshot === null ? '—' : status.screenshot ? '✓' : '✗'}</dd>
      </dl>
      {(active || status.progress > 0) && (
        <div className="progress">
          <div className="bar" style={{ width: `${status.progress}%` }} />
        </div>
      )}
      {status.message && <p className={`small ${status.phase === 'error' ? 'err' : 'muted'}`}>{status.message}</p>}
    </div>
  );
}
