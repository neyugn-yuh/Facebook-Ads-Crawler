// ─── Cấu hình ────────────────────────────────────────────────────────────────

export interface CrawlerConfig {
  /** Tự chạy khi mở trang target (Ads Manager). */
  autoStart: boolean;
  /** Khoảng im lặng (không có DOM mutation) để coi UI là stable. */
  waitForStableMs: number;
  /** Quá thời gian này vẫn crawl dù UI chưa stable. */
  stableTimeoutMs: number;
  /** Debounce mutation trước khi incremental crawl. */
  mutationDebounceMs: number;
  /** Độ sâu tối đa của cây output (sau khi gộp wrapper). */
  maxDepth: number;
  /** Số node tối đa mỗi snapshot. */
  maxNodes: number;
  /** Cắt text dài hơn giá trị này. */
  maxTextLength: number;
  captureScreenshot: boolean;
  extractText: boolean;
  extractAssets: boolean;
  extractStyles: boolean;
  detectComponents: boolean;
  /** Ẩn dữ liệu động (tên campaign, số tiền, ID...). */
  sanitizeDynamicData: boolean;
  /** Gộp các div/span bọc ngoài không có tác dụng hiển thị. */
  collapseWrappers: boolean;
  /** Theo dõi mutation để cập nhật snapshot (incremental) + chụp state modal/menu. */
  trackMutations: boolean;
  /** Mỗi route lưu tối đa bao nhiêu state (modal, menu, dropdown...). */
  maxStatesPerRoute: number;
  /** Các từ luôn bị thay bằng <REDACTED> (tên bạn, tên tài khoản quảng cáo...). */
  redactTerms: string[];
  /** Regex URL được coi là trang target. */
  targetUrlPatterns: string[];
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Map CSS property → giá trị computed (đã lọc giá trị mặc định). */
export type UIStyles = Record<string, string>;

export type ComponentType =
  | 'Page' | 'Header' | 'Navigation' | 'Sidebar' | 'Main' | 'Footer' | 'Toolbar' | 'SearchBar'
  | 'Button' | 'IconButton' | 'Link' | 'Input' | 'TextArea' | 'Select' | 'Checkbox' | 'Radio' | 'Toggle'
  | 'Table' | 'TableHeader' | 'TableRow' | 'TableHeaderCell' | 'TableCell'
  | 'Modal' | 'Menu' | 'MenuItem' | 'Popover' | 'Tooltip' | 'Tabs' | 'Tab'
  | 'List' | 'ListItem' | 'Heading' | 'Icon' | 'Image' | 'Badge' | 'Card' | 'Divider'
  | 'Alert' | 'ProgressBar' | 'Form' | 'Label';

export interface UINode {
  id: string;
  tag: string;
  role?: string;
  /** Loại component suy luận được. */
  component?: ComponentType;
  /** Signature cấu trúc — các node cùng sig là cùng 1 component lặp lại. */
  sig?: string;
  /** Text trực tiếp của node (đã sanitize, cắt ngắn). */
  text?: string;
  /** Vùng scroll: text của toàn bộ item (kể cả item nằm ngoài vùng nhìn thấy / list ảo hoá). */
  scrollItems?: string[];
  attributes: Record<string, string>;
  /** Toạ độ so với viewport lúc chụp (khớp với screenshot). */
  rect: Rect;
  /** Tham chiếu tới snapshot.styles[styleId]. */
  styleId?: string;
  /** Index vào snapshot.assets nếu node là ảnh/svg/background-image. */
  assetIndex?: number;
  children: UINode[];
}

export interface AssetInfo {
  nodeId: string;
  type: 'image' | 'svg' | 'background-image';
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  /** Chỉ lưu host, không lưu URL đầy đủ (URL fbcdn có thể chứa token). */
  host?: string;
  alt?: string;
  viewBox?: string;
  fill?: string;
  pathCount?: number;
  backgroundPosition?: string;
  backgroundSize?: string;
  /** Có vẻ là sprite icon (background-image + background-position). */
  sprite?: boolean;
}

export interface TokenCount {
  value: string;
  count: number;
}

export interface DesignTokens {
  colors: TokenCount[];
  textColors: TokenCount[];
  backgroundColors: TokenCount[];
  borderColors: TokenCount[];
  spacing: TokenCount[];
  fontFamilies: TokenCount[];
  fontSizes: TokenCount[];
  fontWeights: TokenCount[];
  lineHeights: TokenCount[];
  radius: TokenCount[];
  shadows: TokenCount[];
  borderWidths: TokenCount[];
  /** CSS custom properties lấy từ :root / body (Facebook định nghĩa rất nhiều biến màu ở đây). */
  cssVariables: Record<string, string>;
}

export interface ComponentGroup {
  signature: string;
  type: string;
  name: string;
  count: number;
  exampleNodeId: string;
  nodeIds: string[];
  size: { width: number; height: number };
}

export interface ComponentTreeNode {
  name: string;
  nodeId: string;
  count?: number;
  children: ComponentTreeNode[];
}

export interface PageSnapshot {
  /** Khoá lưu trữ: route slug (+ state). */
  id: string;
  url: string;
  route: string;
  /** Tên state, ví dụ "base", "dialog-create-campaign". */
  state: string;
  title: string;
  timestamp: number;
  viewport: { width: number; height: number; devicePixelRatio: number };
  scroll: { x: number; y: number };
  stats: {
    nodes: number;
    domElementsVisited: number;
    truncated: boolean;
    durationMs: number;
    components: number;
    tokens: number;
  };
  root: UINode;
  styles: Record<string, UIStyles>;
  tokens: DesignTokens;
  components: ComponentGroup[];
  componentTree: ComponentTreeNode | null;
  assets: AssetInfo[];
  hasScreenshot: boolean;
  /** Thời điểm chụp screenshot (incremental update không chụp lại). */
  screenshotAt?: number;
  screenshotError?: string;
  crawlerVersion: string;
}

/** Bản tóm tắt để side panel hiển thị danh sách. */
export interface SnapshotSummary {
  id: string;
  route: string;
  state: string;
  title: string;
  url: string;
  timestamp: number;
  stats: PageSnapshot['stats'];
  hasScreenshot: boolean;
  screenshotError?: string;
}

// ─── Trạng thái crawler ────────────────────────────────────────────────────

export type CrawlerPhase = 'idle' | 'waiting' | 'crawling' | 'analyzing' | 'saving' | 'completed' | 'watching' | 'error' | 'disabled';

export interface CrawlerStatus {
  tabId?: number;
  phase: CrawlerPhase;
  url?: string;
  route?: string;
  state?: string;
  progress: number;
  nodes: number;
  components: number;
  tokens: number;
  screenshot: boolean | null;
  message?: string;
  updatedAt: number;
}
