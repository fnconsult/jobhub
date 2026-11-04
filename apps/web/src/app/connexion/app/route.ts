import { getAuth } from "@/auth/server";
import { webSignInFromAppLink } from "@/auth/app-sign-in";

/**
 * The magic link asked from the native app (#685), opened in a browser: the app is not installed, or the link was
 * opened elsewhere. It signs in on the web with the link's token (app-sign-in.ts). With the app installed, the system
 * opens the app instead, by a universal link or an App Link, and this route is never asked.
 */
export function GET(request: Request) {
  const { pathname, search } = new URL(request.url);
  const target = webSignInFromAppLink(new URL(`${pathname}${search}`, String(getAuth().options.baseURL)));
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
