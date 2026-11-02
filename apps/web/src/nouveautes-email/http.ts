import { isSupportedLocale } from "@jobhub/shared/i18n";
import { routes } from "../routes";
import type { NouveautesEmails } from "./index";

/**
 * The answer to a POST on a Nouveautés email's unsubscribe URL (`?token=`), as for the Job Digest's. No session: the
 * token alone names the subscription.
 *  - From the mail client's one-click unsubscribe (body `List-Unsubscribe=One-Click`, RFC 8058): 200, or 404 for a
 *    token that names no subscription. Never a redirect.
 *  - From the unsubscribe page's button: 303 back to the page (in its `lang`), saying whether it worked.
 */
export async function unsubscribeResponse(request: Request, emails: Pick<NouveautesEmails, "unsubscribeByToken">): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const form = await request.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const done = await emails.unsubscribeByToken(query.get("token") ?? "");
  if (oneClick) return Response.json(done ? { unsubscribed: true } : { error: "not_found" }, { status: done ? 200 : 404 });
  const page = new URL(routes.nouveautesEmailUnsubscribe, request.url);
  page.searchParams.set("done", done ? "1" : "0");
  const lang = query.get("lang");
  if (isSupportedLocale(lang)) page.searchParams.set("lang", lang);
  return new Response(null, { status: 303, headers: { location: page.toString() } });
}
