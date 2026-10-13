import { useEffect, useState } from 'react';
import { getScreenshot } from '../../shared/storage/db';
import type { SnapshotSummary } from '../../shared/types';

interface Props {
  snap: SnapshotSummary;
  onView: () => void;
  onJson: () => void;
  onZip: () => void;
  onDelete: () => void;
}

export function SnapshotItem({ snap, onView, onJson, onZip, onDelete }: Props) {
  const [thumb, setThumb] = useState<string>();

  useEffect(() => {
    let url: string | undefined;
    if (snap.hasScreenshot) {
      void getScreenshot(snap.id).then((b) => {
        if (b) setThumb((url = URL.createObjectURL(b)));
      });
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [snap.id, snap.hasScreenshot]);

  return (
    <li className="snap">
      <button className="thumb" onClick={onView} title="Mở viewer">
        {thumb ? <img src={thumb} alt="" /> : <span className="no-shot">no screenshot</span>}
      </button>
      <div className="snap-body">
        <div className="snap-title" title={snap.id}>
          {snap.route}
          {snap.state !== 'base' && <span className="tag">{snap.state}</span>}
        </div>
        <div className="muted small">
          {snap.stats.nodes.toLocaleString()} node · {snap.stats.components} comp · {snap.stats.tokens} token ·{' '}
          {new Date(snap.timestamp).toLocaleTimeString()}
          {snap.stats.truncated && ' · cắt bớt'}
        </div>
        {snap.screenshotError && <div className="small warn">{snap.screenshotError}</div>}
        <div className="snap-actions">
          <button onClick={onView}>Viewer</button>
          <button onClick={onJson}>JSON</button>
          <button onClick={onZip}>ZIP</button>
          <button className="del" onClick={onDelete}>
            Xoá
          </button>
        </div>
      </div>
    </li>
  );
}
