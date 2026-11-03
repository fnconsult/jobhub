import { NextResponse, type NextRequest } from "next/server";
import { permanentSuperAdminsFromEnv } from "@/admin/access";
import { sharedPool } from "@/database/pool";
import { pendingSessionGate, secondStepHref, SECOND_STEP_REQUIRED } from "./gate";
import { createPendingSessions, type PendingSessions } from "./pending-sessions";

// On globalThis: Next.js may bundle the proxy apart from the pages, each with its copy of this module.
const holder = globalThis as { __jobhubPendingSessions?: PendingSessions };

/** The app's pending sessions, on the database named by DATABASE_URL, ADMIN_EMAILS' super-admins among those who must have it. */
export function getPendingSessions(): PendingSessions {
  return (holder.__jobhubPendingSessions ??= createPendingSessions(sharedPool(), { adminEmails: permanentSuperAdminsFromEnv(process.env).emails }));
}

/**
 * The proxy's answer to a request made with a session pending its second step, or its setup (ADR-0075, gate.ts): a
 * redirect to the second step's page for a page, 401 `{ error: "second_step_required" }` for an API route or a Server Action; null when the
 * request goes on (no such session, or what it asks stays open). Never fails a request: when the database cannot be
 * read, it goes on, and the session is still refused where it is read (auth/server.ts, getCurrentSession).
 */
export async function pendingSessionAnswer(request: NextRequest): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  if (!process.env.DATABASE_URL || pendingSessionGate(pathname, request.method) === "open") return null;
  let pending;
  try {
    pending = await getPendingSessions().of(request.headers);
  } catch (error) {
    console.error("[two-step-verification] could not tell whether the session is pending", error);
    return null;
  }
  if (!pending) return null;
  if (pendingSessionGate(pathname, request.method) === "redirect") return NextResponse.redirect(new URL(secondStepHref(`${pathname}${search}`), request.url));
  return NextResponse.json({ error: SECOND_STEP_REQUIRED }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
