// Phát hiện đổi URL trong SPA: pushState/replaceState (qua route-hook), popstate,
// Navigation API, và kiểm tra dự phòng khi có mutation.
import { LOCATION_CHANGE_EVENT } from '../../shared/constants';

export class RouteObserver {
  private lastUrl = location.href;
  private handler = () => this.check();

  constructor(private onChange: (url: string, prev: string) => void) {}

  start() {
    window.addEventListener(LOCATION_CHANGE_EVENT, this.handler);
    window.addEventListener('popstate', this.handler);
    window.addEventListener('hashchange', this.handler);
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    nav?.addEventListener('navigatesuccess', this.handler);
  }

  stop() {
    window.removeEventListener(LOCATION_CHANGE_EVENT, this.handler);
    window.removeEventListener('popstate', this.handler);
    window.removeEventListener('hashchange', this.handler);
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    nav?.removeEventListener('navigatesuccess', this.handler);
  }

  /** Gọi thêm từ MutationObserver để bắt trường hợp hook không chạy. */
  check() {
    const url = location.href;
    if (url === this.lastUrl) return;
    const prev = this.lastUrl;
    this.lastUrl = url;
    this.onChange(url, prev);
  }
}
