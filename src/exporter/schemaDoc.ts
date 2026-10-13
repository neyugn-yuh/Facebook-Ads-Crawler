export const SCHEMA_MD = `# facebook-ads-ui — định dạng dữ liệu

Gói này do extension **UI Auto Crawler** tạo ra. Nó chỉ chứa dữ liệu giao diện (cấu trúc DOM, CSS, layout,
design token, component, screenshot) để tham khảo khi dựng lại UI. Không chứa cookie, token, session hay
dữ liệu campaign: text động đã được thay bằng placeholder.

\`\`\`
facebook-ads-ui/
├── project.json          # danh sách page/state, cấu hình lúc crawl
├── tokens.json           # design tokens gộp của mọi page
├── SCHEMA.md
├── assets/assets.json    # metadata ảnh / svg / background-image (không có file ảnh gốc)
└── pages/<id>/
    ├── snapshot.json     # toàn bộ cây UI của page/state
    ├── screenshot.png    # ảnh viewport lúc crawl (có thể thiếu nếu không chụp được)
    ├── tokens.json
    ├── components.json   # { groups, tree }
    └── assets.json
\`\`\`

\`<id>\` = slug của route, cộng \`__<state>\` nếu đang mở modal/menu (vd \`adsmanager-manage-campaigns__dialog-create-campaign\`).

## snapshot.json

| field | ý nghĩa |
|---|---|
| \`viewport\` | width/height/devicePixelRatio lúc chụp. Screenshot có kích thước viewport × DPR |
| \`root\` | cây \`UINode\` |
| \`styles\` | bảng style dùng chung: \`styleId → { cssProperty: value }\` |
| \`tokens\` | thống kê giá trị CSS lặp lại (\`{ value, count }\`) + \`cssVariables\` |
| \`components\` | nhóm component lặp lại (cùng signature) |
| \`componentTree\` | cây rút gọn chỉ gồm component, anh em lặp lại gộp thành \`count\` |
| \`assets\` | metadata ảnh; \`UINode.assetIndex\` trỏ vào mảng này |
| \`screenshotAt\` | thời điểm chụp; \`timestamp\` có thể mới hơn nếu snapshot được cập nhật incremental |

### UINode

\`\`\`ts
interface UINode {
  id: string;
  tag: string;                 // tên thẻ HTML
  role?: string;               // ARIA role (explicit hoặc implicit)
  component?: string;          // Button, Table, TableRow, Modal, Sidebar, Card, Badge...
  sig?: string;                // signature cấu trúc; cùng sig = cùng component
  text?: string;               // text trực tiếp (đã sanitize, tối đa maxTextLength)
  attributes: Record<string, string>;  // role, aria-*, placeholder, href (chỉ path), alt, title...
  rect: { x, y, width, height };       // px, so với viewport lúc chụp (khớp screenshot)
  styleId?: string;            // → snapshot.styles[styleId]
  assetIndex?: number;         // → snapshot.assets[assetIndex]
  children: UINode[];
}
\`\`\`

### Quy tắc style

* Chỉ lưu **giá trị khác mặc định** (vd không lưu \`position: static\`, \`opacity: 1\`, \`margin: 0px\`).
* Property **kế thừa** (color, font-*, line-height, letter-spacing, text-align, white-space, cursor...) chỉ lưu
  khi **khác node cha** trong cây. Muốn biết giá trị thực tế thì đi từ root xuống và kế thừa như CSS.
* \`width\`/\`height\` không nằm trong style: dùng \`rect\` (luôn là kích thước đã render).
* Màu được chuẩn hoá sang HEX (\`#RRGGBB\` hoặc \`#RRGGBBAA\`).
* \`background-image: url(<ASSET>)\`: URL gốc bị bỏ, metadata nằm trong \`assets\`.
* Các div/span bọc ngoài không có tác dụng hiển thị đã được gộp (\`collapseWrappers\`), nên cây gọn hơn DOM thật.

### Placeholder của dữ liệu động

| placeholder | thay cho |
|---|---|
| \`<TEXT:n>\` | text trong ô bảng/grid (n = số ký tự gốc, giúp giữ độ rộng layout) |
| \`<CURRENCY>\` \`<PERCENT>\` \`<NUMBER>\` | số tiền, phần trăm, số ≥ 3 chữ số |
| \`<DATE>\` \`<TIME>\` \`<ID>\` | ngày, giờ, chuỗi số dài (ID tài khoản/campaign) |
| \`<EMAIL>\` \`<URL>\` \`<REDACTED>\` | email, URL, các từ trong danh sách redactTerms |

Nhãn ngắn lặp lại ≥ 3 lần trong bảng (vd "Active", "Off") được giữ nguyên vì đó là nhãn UI.

## Gợi ý dựng lại UI

1. Lấy \`tokens.json\` (và \`cssVariables\`) làm theme: màu, font size, spacing, radius, shadow.
2. Đi theo \`components.json → tree\` để chia layout: Header / Sidebar / Toolbar / Table / Modal.
3. Với từng component, mở node \`exampleNodeId\` trong \`snapshot.json\` để lấy style chi tiết.
4. Đối chiếu \`rect\` với \`screenshot.png\` để kiểm tra kích thước, vị trí.
5. Icon: \`assets\` chỉ có metadata (kích thước, viewBox, màu). Dùng bộ icon mã nguồn mở tương đương, không dùng logo/icon của Meta.
`;
