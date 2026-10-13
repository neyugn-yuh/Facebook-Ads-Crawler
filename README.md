# UI Auto Crawler

Chrome Extension (Manifest V3) tự động crawl **giao diện** của Facebook Ads Manager: cấu trúc DOM, computed CSS,
layout, design tokens, component và screenshot. Kết quả dùng làm tài liệu tham khảo để dựng lại UI cho dự án nội bộ.

Extension chỉ lấy dữ liệu giao diện. Nó **không** đọc cookie, access token, session hay mật khẩu, **không** gửi dữ liệu
đi đâu, và che dữ liệu động (tên campaign, số tiền, ID...) trước khi lưu.

---

## Cài đặt

```bash
npm install
npm run build        # hoặc: npm run watch (tự build lại khi sửa code)
```

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked** và chọn thư mục `dist/`.
3. Ghim icon **UI Auto Crawler** lên thanh công cụ.

Yêu cầu Chrome 116 trở lên (cần Side Panel API và content script `world: "MAIN"`).

## Sử dụng

1. Bấm icon extension để mở **side panel**.
2. Lần đầu, bấm **Cấp quyền screenshot**. Chrome chỉ cho `captureVisibleTab` chạy khi extension có quyền `<all_urls>`
   (hoặc khi bạn vừa bấm icon trên tab đó). Đây là quyền *tuỳ chọn*: extension vẫn chỉ tự chạy trên `*.facebook.com`.
   Nếu không cấp, mọi thứ khác vẫn chạy, chỉ thiếu ảnh chụp.
3. Mở Ads Manager (`adsmanager.facebook.com` hoặc `facebook.com/adsmanager`). Crawler tự làm các bước:
   đợi UI ổn định, chụp màn hình, quét DOM, phân tích rồi lưu snapshot. Bạn không cần bấm gì.
4. Cứ dùng Ads Manager bình thường:
   * **Đổi route** (Campaigns → Ad sets → Ads...) thì tạo snapshot mới cho route đó.
   * **Mở modal / menu / dropdown** thì tạo snapshot *state* riêng, vd `adsmanager-manage-campaigns__dialog-create-new-campaign`.
   * **Thay đổi nhỏ** (hover, đổi filter...) thì chỉ crawl lại subtree bị ảnh hưởng rồi merge vào snapshot hiện tại
     (incremental, không chụp lại ảnh).
5. Bấm **Export ZIP** để tải toàn bộ về máy. Nút **Viewer** mở trang xem wireframe dựng từ snapshot, chồng lên
   screenshot để kiểm tra độ chính xác.

Nút **Crawl ngay** crawl thủ công tab hiện tại, dùng được cả với trang khác ngoài Ads Manager.

### Cài đặt trong side panel

| Tuỳ chọn | Mặc định | Ghi chú |
|---|---|---|
| Tự crawl khi mở Ads Manager | bật | `autoStart` |
| Stable sau / Timeout | 1000 / 15000 ms | Đủ 1000 ms không có DOM mutation thì coi là stable; quá 15000 ms thì crawl luôn |
| Số node tối đa | 10.000 | Khi dùng quá 70% giới hạn thì chỉ lấy node trong hoặc gần viewport |
| Gộp div bọc ngoài | bật | Bỏ các div/span chỉ bọc 1 con, cùng kích thước, không có style riêng (Facebook có rất nhiều loại này) |
| Ẩn dữ liệu động | bật | Xem mục *Bảo mật* bên dưới |
| Từ luôn bị ẩn | trống | **Nên điền** tên bạn, tên tài khoản quảng cáo, tên business |
| Regex URL tự crawl | Ads Manager | Thêm regex nếu muốn tự crawl trang khác, vd Business Suite |

## Dữ liệu export

```
facebook-ads-ui/
├── project.json
├── tokens.json                 # design tokens gộp của mọi page
├── SCHEMA.md                   # mô tả chi tiết định dạng
├── assets/assets.json
└── pages/<route>[__<state>]/
    ├── snapshot.json           # cây UINode + bảng style + tokens + components + assets
    ├── screenshot.png
    ├── tokens.json
    ├── components.json         # { groups: component lặp lại, tree: cây component }
    └── assets.json
```

Mỗi node có dạng:

```jsonc
{
  "id": "n1n", "tag": "div", "role": "gridcell", "component": "TableCell", "sig": "1re04mh",
  "text": "<CURRENCY>",
  "attributes": { "role": "gridcell" },
  "rect": { "x": 772, "y": 272.5, "width": 214.3, "height": 16 },   // khớp với screenshot
  "styleId": "s1f",                                                  // → snapshot.styles
  "children": []
}
```

Các quy tắc đáng chú ý (chi tiết xem trong `SCHEMA.md` của file ZIP):

* Style được **dedupe** vào `snapshot.styles` và chỉ giữ giá trị khác mặc định.
* Property kế thừa (color, font...) chỉ lưu khi khác node cha.
* Màu đã đổi sang HEX.
* `tokens.cssVariables` chứa các CSS custom property của trang. Facebook định nghĩa màu theme ở đây
  (vd `--primary-button-background`), nên đây là nguồn token tốt nhất.
* `components.tree` là bộ khung để chia layout:
  `Page → Header / Navigation / Main → Tabs / Toolbar / Table → TableRow × N`.

## Bảo mật & quyền riêng tư

| Không bao giờ đọc | Cách xử lý |
|---|---|
| Cookie, token, session, mật khẩu | Không xin quyền `cookies` / `webRequest`, không đọc `document.cookie`, `localStorage` hay request mạng |
| Giá trị ô input | Không đọc `.value`, chỉ lấy `placeholder` |
| URL ảnh (có thể chứa token) | Chỉ lưu host (`scontent.xx.fbcdn.net`) |
| Query string (act=, selected_campaign_ids=...) | Bị bỏ khỏi `url` và `href` |

Dữ liệu động được thay bằng placeholder: `<CURRENCY> <PERCENT> <NUMBER> <DATE> <TIME> <ID> <EMAIL> <URL> <REDACTED>`.
Text trong ô bảng hoặc grid thành `<TEXT:n>` (n là số ký tự, để giữ độ rộng layout). Riêng nhãn ngắn lặp lại ≥ 3 lần
trong bảng (vd "Active", "Off") được giữ vì đó là nhãn UI.

Heuristic không bắt được mọi trường hợp. Ví dụ tên tài khoản quảng cáo ở header không nằm trong bảng, nên hãy thêm
nó vào **Từ luôn bị ẩn**. Trước khi chia sẻ file ZIP, nên mở vài `snapshot.json` ra kiểm tra.

Toàn bộ dữ liệu nằm trong IndexedDB của extension trên máy bạn. Extension không có backend.

## Kiến trúc

```
src/
├── background/index.ts          # service worker: screenshot, lưu IndexedDB, trạng thái theo tab, badge
├── content/
│   ├── index.ts                 # auto start
│   ├── crawler/
│   │   ├── Crawler.ts           # điều phối: stable → screenshot → scan → analyze → save; route/state/incremental
│   │   ├── DOMScanner.ts        # duyệt DOM iterative (yield mỗi 400 node), lọc ẩn, gộp wrapper
│   │   ├── StabilityDetector.ts # MutationObserver quiet period + timeout
│   │   └── MutationTracker.ts   # debounce mutation → subtree bị ảnh hưởng
│   ├── analyzer/
│   │   ├── StyleAnalyzer.ts     # computed CSS + bảng style dedupe
│   │   ├── LayoutAnalyzer.ts    # rect, viewport
│   │   ├── ComponentDetector.ts # role/tag/heuristic → component, signature, group, component tree
│   │   ├── TokenExtractor.ts    # thống kê token + CSS variables
│   │   └── AssetDetector.ts     # metadata img/svg/background-image/sprite
│   ├── route/
│   │   ├── routeHook.ts         # MAIN world: patch history.pushState/replaceState → phát event
│   │   └── RouteObserver.ts
│   └── sanitizer/DataSanitizer.ts
├── sidepanel/                   # React UI: trạng thái, danh sách snapshot, export, cài đặt
├── viewer/                      # xem wireframe + overlay screenshot + inspect node
├── exporter/                    # ZIP (fflate) + SCHEMA.md
└── shared/                      # types, constants, IndexedDB, utils
```

Hiệu năng: với trang thử nghiệm có khoảng 25.000 element, một lần crawl mất khoảng 2,6 s. Trong lúc đó trang không bị
khựng quá 41 ms mỗi frame, nhờ việc duyệt DOM có yield và nhờ node ngoài viewport được ưu tiên thấp khi gần chạm giới hạn.

## Giới hạn hiện tại

* **Chưa có full-page screenshot** (Phase 4). Ads Manager cuộn trong container riêng chứ không cuộn `window`,
  nên chụp từng đoạn rồi ghép cần xử lý riêng. Hiện chỉ có ảnh viewport.
* Computed style luôn trả về giá trị đã resolve. Ví dụ `margin-left: auto` thành `989px`, còn `%` và `fr` thành px.
  Khi dựng lại, hãy đối chiếu với `rect` và screenshot để đoán ý đồ layout (flex/grid).
* Chưa lấy `::before` / `::after`, không đi vào `iframe` và shadow DOM.
* Nhận diện component dựa trên heuristic. Facebook dùng rất nhiều `div` với ARIA role, nên role là tín hiệu chính.
* Snapshot incremental không chụp lại ảnh, nên `timestamp` có thể mới hơn `screenshotAt`.
* Chưa có code generator React/Tailwind (Phase 6). Có thể dùng `components.json` + `tokens.json` làm input
  cho bước này sau.

## Lưu ý sử dụng

Công cụ này dùng để tham khảo bố cục và phong cách khi dựng UI nội bộ. Khi dựng lại:

* Không dùng logo, icon, sprite hay tên thương hiệu của Meta. Hãy thay bằng bộ icon mã nguồn mở
  (Lucide, Material Symbols...) và brand của dự án.
* Extension không tự điều hướng hay click. Nó chỉ đọc giao diện của trang bạn đang tự mở, trong phiên đăng nhập
  của chính bạn.
