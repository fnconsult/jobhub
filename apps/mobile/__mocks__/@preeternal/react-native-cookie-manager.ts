// The WebViews' cookie store, in memory (src/testing-device.ts).
import { fakeWebView, type WebViewCookie } from "../../src/testing-device";

const CookieManager = {
  set: async (url: string, cookie: Omit<WebViewCookie, "url">) => {
    fakeWebView.cookies = [...fakeWebView.cookies.filter((kept) => !(kept.url === url && kept.name === cookie.name)), { url, ...cookie }];
    return true;
  },
  clearByName: async (url: string, name: string) => {
    fakeWebView.cookies = fakeWebView.cookies.filter((kept) => !(kept.url === url && kept.name === name));
    return true;
  },
  clearAll: async () => {
    fakeWebView.cookies = [];
    return true;
  },
  clearAllStores: async () => {
    fakeWebView.cookies = [];
    return true;
  },
};
export default CookieManager;
