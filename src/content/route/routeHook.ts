// Chạy ở MAIN world (cùng JS context với trang) lúc document_start.
// Content script ở isolated world không thấy được lời gọi history.pushState của trang,
// nên ta patch ở đây rồi phát 1 DOM event (event DOM đi xuyên qua các world).
// File này KHÔNG đọc hay gửi bất kỳ dữ liệu nào của trang.
import { LOCATION_CHANGE_EVENT } from '../../shared/constants';

(() => {
  const w = window as unknown as { __uiCrawlerRouteHook?: boolean };
  if (w.__uiCrawlerRouteHook) return;
  w.__uiCrawlerRouteHook = true;

  const notify = () => window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const ret = original.apply(this, args);
      notify();
      return ret;
    };
  }
})();
