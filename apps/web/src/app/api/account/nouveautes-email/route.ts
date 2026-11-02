import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getNouveautesEmails } from "@/nouveautes-email/server";

const body = z.object({ subscribed: z.boolean() });

/**
 * The Candidate ticks or unticks « Recevoir un e-mail quand Jobbbox annonce une nouveauté » (Mon compte, Préférences, #566).
 * Body: { subscribed: boolean }.
 * 200 { subscribed, subscribedAt } · 400 · 401 · 403
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const emails = getNouveautesEmails();
  return NextResponse.json(await (parsed.data.subscribed ? emails.subscribe(candidate.id) : emails.unsubscribe(candidate.id)));
}
