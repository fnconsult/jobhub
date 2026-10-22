import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppointmentReminders } from "@/appointment-reminders/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";

const body = z.object({ enabled: z.boolean() });

/**
 * The Candidate switches their Appointment Reminders on or off (Mon compte, Rappels).
 * Body: { enabled: boolean }.
 * 200 { enabled } · 400 · 401 · 403
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await getAppointmentReminders().setEnabled(candidate.id, parsed.data.enabled);
  return NextResponse.json({ enabled: parsed.data.enabled });
}
