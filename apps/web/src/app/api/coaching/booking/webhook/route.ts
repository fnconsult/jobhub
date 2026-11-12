// « Espace coach v2 » (ADR-0106): a 404 while it is off, as before the Human Coach epic.
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { getCoachingBooking } from "@/coaching-booking/server";
import { bookingBody } from "@/coaching-booking/body";
export async function POST(request: Request) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const raw = await bookingBody(request);
  if (raw === null) return Response.json({ error: "too_large" }, { status: 413 });
  const result = await getCoachingBooking().webhook(raw, request.headers.get("x-cal-signature-256"));
  return Response.json({ received: result.verified }, { status: result.verified ? 200 : 400 });
}
