import { NextResponse, type NextRequest } from "next/server";
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { LOCALE_HEADER } from "@/i18n/locale-header";

/**
 * Pages whose language is chosen by their URL's `lang` (the Job Digest
 * unsubscribe page): passes it on as LOCALE_HEADER, so the root layout's
 * <html lang> matches the page's text, not only the page itself.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(LOCALE_HEADER);
  const lang = request.nextUrl.searchParams.get("lang");
  if (isSupportedLocale(lang)) headers.set(LOCALE_HEADER, lang);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // routes.jobDigestUnsubscribe (the matcher must be a literal).
  matcher: "/desabonnement",
};
