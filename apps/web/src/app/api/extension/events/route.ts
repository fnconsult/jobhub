import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { extensionCallOf, getExtensionEvents } from "@/extension-events/server";

/**
 * Records an error the browser extension reports (#924), as an Extension Event: a page it could not capture
 * (`captureImpossible`), a call to the web app that failed, an unexpected failure in its Side Panel or content script.
 * For a Guest or a signed-in Candidate; only from the extension (its Origin, an extension of EXTENSION_ORIGINS).
 * Body: { errorCode, messageKey?, route?, httpStatus?, place: "side_panel" | "content_script" | "page_button", pageDomain? };
 * anything else, a page's `url` included, is ignored. The Extension Version is read from its header, the browser's family
 * and major version from the User-Agent; never the page's address, its text, a stack trace or the IP address.
 * The extension sends it at best, once, without waiting on it.
 * 204 · 400 { errors: FieldError[] } · 403 · 429 { error: "too_many" } (REPORTING_LIMIT within REPORTING_WINDOW_MINUTES)
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  const extension = await extensionCallOf(request, candidate?.id ?? null);
  if (!extension) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body: unknown = await request.json().catch(() => undefined);
  const result = await getExtensionEvents().report(extension, body, {
    userAgent: request.headers.get("user-agent"),
    // A Guest is counted by the address the host's proxy saw, held in this process's memory for the window only.
    requester: candidate ? `candidate:${candidate.id}` : `guest:${sourceAddressOf(request) ?? "unknown"}`,
  });
  if (result.ok) return new NextResponse(null, { status: 204 });
  if ("refused" in result) return NextResponse.json({ error: result.refused }, { status: 429 });
  return NextResponse.json({ errors: result.errors }, { status: 400 });
}

/** The address the host's proxy saw: the last of X-Forwarded-For (the one it added), else X-Real-IP. */
function sourceAddressOf(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}
