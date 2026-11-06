import * as WebBrowser from "expo-web-browser";

/**
 * The in-app browser Stripe Checkout opens in (#694, ADR-0076; App Store guideline 3.1.3(d)): SFSafariViewController on
 * iOS, a Custom Tab on Android. It shares no cookie with the app and carries no session: Checkout needs none.
 *
 * `open` resolves when the browser is closed, by the person or by `dismiss` (iOS), and at once on Android, where the
 * Custom Tab stays above the app until the person goes back. Its answer never says whether anything was paid.
 */
export const inAppBrowser = {
  open: async (url: string): Promise<void> => {
    await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: "close", enableBarCollapsing: true });
  },
  /** Closes it, when the universal link brought the app back while it was still open (iOS; Android's closes itself). */
  dismiss: (): void => {
    void Promise.resolve()
      .then(() => WebBrowser.dismissBrowser())
      .catch(() => {});
  },
};
