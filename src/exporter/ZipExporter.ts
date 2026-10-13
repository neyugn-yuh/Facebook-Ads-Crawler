// Đóng gói toàn bộ snapshot thành facebook-ads-ui.zip (chạy trong side panel).
import { strToU8, zipSync, type Zippable } from 'fflate';
import { CRAWLER_VERSION } from '../shared/constants';
import { getAllSnapshots, getScreenshot } from '../shared/storage/db';
import type { DesignTokens, PageSnapshot, TokenCount } from '../shared/types';
import { loadConfig } from '../shared/utils';
import { SCHEMA_MD } from './schemaDoc';

const ROOT = 'facebook-ads-ui';

const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));

export interface ExportResult {
  blob: Blob;
  filename: string;
  pages: number;
}

export async function buildZip(ids?: string[]): Promise<ExportResult> {
  let snapshots = await getAllSnapshots();
  if (ids) snapshots = snapshots.filter((s) => ids.includes(s.id));
  snapshots.sort((a, b) => a.route.localeCompare(b.route) || a.state.localeCompare(b.state));
  if (!snapshots.length) throw new Error('Chưa có snapshot nào để export');

  const cfg = await loadConfig();
  const files: Zippable = {};
  const pages: Zippable = {};

  for (const s of snapshots) {
    const dir: Zippable = {};
    dir['snapshot.json'] = json(s);
    dir['tokens.json'] = json(s.tokens);
    dir['components.json'] = json({ groups: s.components, tree: s.componentTree });
    dir['assets.json'] = json(s.assets);
    const shot = await getScreenshot(s.id);
    // PNG đã nén sẵn → level 0 cho nhanh
    if (shot) dir['screenshot.png'] = [new Uint8Array(await shot.arrayBuffer()), { level: 0 }];
    pages[s.id] = dir;
  }
  files['pages'] = pages;

  files['project.json'] = json({
    name: ROOT,
    exportedAt: new Date().toISOString(),
    crawlerVersion: CRAWLER_VERSION,
    // redactTerms không export (có thể chứa tên thật)
    config: { ...cfg, redactTerms: cfg.redactTerms.length ? `[${cfg.redactTerms.length} terms]` : [] },
    pages: snapshots.map((s) => ({
      id: s.id,
      route: s.route,
      state: s.state,
      url: s.url,
      title: s.title,
      timestamp: s.timestamp,
      viewport: s.viewport,
      stats: s.stats,
      hasScreenshot: s.hasScreenshot,
      folder: `pages/${s.id}`,
    })),
  });
  files['tokens.json'] = json(mergeTokens(snapshots));
  files['assets'] = {
    'assets.json': json(snapshots.flatMap((s) => s.assets.map((a) => ({ page: s.id, ...a })))),
  };
  files['SCHEMA.md'] = strToU8(SCHEMA_MD);

  const zipped = zipSync({ [ROOT]: files }, { level: 6 });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return {
    blob: new Blob([zipped], { type: 'application/zip' }),
    filename: `${ROOT}-${stamp}.zip`,
    pages: snapshots.length,
  };
}

function mergeList(lists: TokenCount[][], numeric: boolean): TokenCount[] {
  const m = new Map<string, number>();
  for (const l of lists) for (const t of l) m.set(t.value, (m.get(t.value) ?? 0) + t.count);
  const out = [...m.entries()].map(([value, count]) => ({ value, count }));
  return numeric ? out.sort((a, b) => parseFloat(a.value) - parseFloat(b.value)) : out.sort((a, b) => b.count - a.count);
}

export function mergeTokens(snapshots: PageSnapshot[]): DesignTokens {
  const pick = <K extends keyof DesignTokens>(k: K) => snapshots.map((s) => s.tokens[k] as TokenCount[]);
  return {
    colors: mergeList(pick('colors'), false),
    textColors: mergeList(pick('textColors'), false),
    backgroundColors: mergeList(pick('backgroundColors'), false),
    borderColors: mergeList(pick('borderColors'), false),
    spacing: mergeList(pick('spacing'), true),
    fontFamilies: mergeList(pick('fontFamilies'), false),
    fontSizes: mergeList(pick('fontSizes'), true),
    fontWeights: mergeList(pick('fontWeights'), true),
    lineHeights: mergeList(pick('lineHeights'), true),
    radius: mergeList(pick('radius'), true),
    shadows: mergeList(pick('shadows'), false),
    borderWidths: mergeList(pick('borderWidths'), true),
    cssVariables: Object.assign({}, ...snapshots.map((s) => s.tokens.cssVariables)),
  };
}

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } catch {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
