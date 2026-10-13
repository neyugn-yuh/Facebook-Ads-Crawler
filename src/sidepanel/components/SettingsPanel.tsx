import { useState } from 'react';
import { DEFAULT_CONFIG } from '../../shared/constants';
import type { CrawlerConfig } from '../../shared/types';

type BoolKey = { [K in keyof CrawlerConfig]: CrawlerConfig[K] extends boolean ? K : never }[keyof CrawlerConfig];
type NumKey = { [K in keyof CrawlerConfig]: CrawlerConfig[K] extends number ? K : never }[keyof CrawlerConfig];

const BOOLS: Array<[BoolKey, string]> = [
  ['captureScreenshot', 'Chụp screenshot viewport'],
  ['extractStyles', 'Trích xuất computed CSS'],
  ['extractText', 'Lấy text'],
  ['extractAssets', 'Metadata ảnh / SVG'],
  ['detectComponents', 'Nhận diện component'],
  ['collapseWrappers', 'Gộp div bọc ngoài vô nghĩa'],
  ['trackMutations', 'Theo dõi thay đổi (incremental + modal/menu)'],
  ['sanitizeDynamicData', 'Ẩn dữ liệu động (khuyên bật)'],
];

const NUMS: Array<[NumKey, string, number, number]> = [
  ['waitForStableMs', 'Stable sau (ms)', 200, 5000],
  ['stableTimeoutMs', 'Timeout (ms)', 2000, 60000],
  ['maxNodes', 'Số node tối đa', 500, 50000],
  ['maxDepth', 'Độ sâu tối đa', 5, 200],
  ['maxTextLength', 'Độ dài text tối đa', 10, 1000],
  ['maxStatesPerRoute', 'State tối đa / route', 1, 100],
];

export function SettingsPanel({ config, onChange }: { config: CrawlerConfig; onChange: (p: Partial<CrawlerConfig>) => void }) {
  const [redact, setRedact] = useState(config.redactTerms.join('\n'));
  const [patterns, setPatterns] = useState(config.targetUrlPatterns.join('\n'));

  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <details className="card settings">
      <summary>Cài đặt</summary>
      <div className="settings-body">
        {BOOLS.map(([k, label]) => (
          <label key={k} className="switch-row">
            <input type="checkbox" checked={config[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
        <div className="num-grid">
          {NUMS.map(([k, label, min, max]) => (
            <label key={k}>
              <span className="small muted">{label}</span>
              <input
                type="number"
                min={min}
                max={max}
                value={config[k]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) onChange({ [k]: Math.min(max, Math.max(min, v)) });
                }}
              />
            </label>
          ))}
        </div>
        <label className="block">
          <span className="small muted">Từ luôn bị ẩn (mỗi dòng 1 từ: tên bạn, tên tài khoản quảng cáo, tên business…)</span>
          <textarea rows={3} value={redact} onChange={(e) => setRedact(e.target.value)} onBlur={() => onChange({ redactTerms: lines(redact) })} />
        </label>
        <label className="block">
          <span className="small muted">Regex URL tự crawl (mỗi dòng 1 regex)</span>
          <textarea rows={3} value={patterns} onChange={(e) => setPatterns(e.target.value)} onBlur={() => onChange({ targetUrlPatterns: lines(patterns) })} />
        </label>
        <button
          className="btn ghost"
          onClick={() => {
            setRedact('');
            setPatterns(DEFAULT_CONFIG.targetUrlPatterns.join('\n'));
            onChange({ ...DEFAULT_CONFIG });
          }}
        >
          Khôi phục mặc định
        </button>
        <p className="small muted">Thay đổi áp dụng ở lần crawl tiếp theo.</p>
      </div>
    </details>
  );
}
