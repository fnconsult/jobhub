import { describe, expect, it } from "vitest";
import { inAppRedirect, inAppWebView } from "./in-app";

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IN_APP_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 JobbboxApp/1";
const IN_APP_ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 JobbboxApp/1";

describe("a page shown inside the Jobbbox app's WebView (#689)", () => {
  it("is known by the app's name in the user agent, on iOS and Android, never a browser's", () => {
    expect(inAppWebView(IN_APP_IOS)).toBe(true);
    expect(inAppWebView(IN_APP_ANDROID)).toBe(true);
    expect(inAppWebView(SAFARI)).toBe(false);
    expect(inAppWebView(null)).toBe(false);
    expect(inAppWebView("Mozilla/5.0 NotJobbboxApp/1")).toBe(false);
  });

  it("sends the Order pages back to the page they were chosen on inside the app: nothing is bought there", () => {
    expect(inAppRedirect("/abonnement/commande", IN_APP_IOS)).toBe("/abonnement");
    expect(inAppRedirect("/coachs/commande", IN_APP_ANDROID)).toBe("/coachs");
    expect(inAppRedirect("/en/abonnement/commande", IN_APP_IOS)).toBe("/en/abonnement");
  });

  it("leaves every other page, and every page in a browser, as it is", () => {
    for (const path of ["/abonnement", "/abonnement/retractation", "/compte/donnees", "/legal/cgu", "/espace-coach"]) expect(inAppRedirect(path, IN_APP_IOS)).toBeNull();
    expect(inAppRedirect("/abonnement/commande", SAFARI)).toBeNull();
  });
});
