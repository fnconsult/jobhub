/**
 * A page of the web app shown inside the Jobbbox app (#689, ADR-0076): Mon compte, the subscription, the Withdrawal,
 * the Legal Texts and the Coach space open in its WebViews, which name the app in their user agent
 * (APP_WEBVIEW_USER_AGENT). There the web shows no Sidebar of its own (the app has its drawer), and nothing is bought:
 * an Order page is sent back to the page its Plan or Human Coach was chosen on (App Store guideline 3.1.1).
 */
import { APP_WEBVIEW_USER_AGENT } from "@jobhub/shared";
import { splitLocalePrefix } from "@/i18n/locale-header";
import { COACHING_ORDER, PLAN_ORDER, routes } from "@/routes";

const IN_APP = new RegExp(`(?:^|\\s)${APP_WEBVIEW_USER_AGENT}/`);

/** Whether the request's user agent is the app's WebView. */
export function inAppWebView(userAgent: string | null | undefined): boolean {
  return IN_APP.test(userAgent ?? "");
}

const SENT_BACK: Record<string, string> = { [PLAN_ORDER]: routes.subscription, [COACHING_ORDER]: routes.coaching };

/** Where a page asked inside the app's WebView goes instead (an Order page, under `/en` too), or null. */
export function inAppRedirect(pathname: string, userAgent: string | null | undefined): string | null {
  if (!inAppWebView(userAgent)) return null;
  const { pathname: page } = splitLocalePrefix(pathname);
  const back = SENT_BACK[page];
  return back ? `${pathname.slice(0, pathname.length - page.length)}${back}` : null;
}
