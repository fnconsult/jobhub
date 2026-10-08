import { isSupportedLocale } from "@jobhub/shared/i18n";
import { routes } from "../routes";
import type { JobDigests } from "./index";

/**
 * The answer to a POST on an email's unsubscribe URL (`?token=`). No session:
 * the token alone names the opt-in.
 *  - From the mail client's one-click unsubscribe (body `List-Unsubscribe=One-Click`,
 *    RFC 8058): 200, or 404 for a token that names no opt-in. Never a redirect.
 *  - From the unsubscribe page's button: 303 back to the page (in its `lang`), saying whether it worked.
 */
export async function unsubscribeResponse(request: Request, jobDigests: Pick<JobDigests, "unsubscribeByToken">): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const token = query.get("token") ?? "";
  const form = await request.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const done = await jobDigests.unsubscribeByToken(token);
  if (oneClick) return Response.json(done ? { unsubscribed: true } : { error: "not_found" }, { status: done ? 200 : 404 });
  const page = new URL(routes.jobDigestUnsubscribe, request.url);
  page.searchParams.set("done", done ? "1" : "0");
  const lang = query.get("lang");
  if (isSupportedLocale(lang)) page.searchParams.set("lang", lang);
  return new Response(null, { status: 303, headers: { location: page.toString() } });
}
