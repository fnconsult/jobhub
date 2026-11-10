import { getCoachingBooking } from "@/coaching-booking/server";
import { bookingBody } from "@/coaching-booking/body";
export async function POST(request: Request) {
  const raw = await bookingBody(request);
  if (raw === null) return Response.json({ error: "too_large" }, { status: 413 });
  const result = await getCoachingBooking().webhook(raw, request.headers.get("x-cal-signature-256"));
  return Response.json({ received: result.verified }, { status: result.verified ? 200 : 400 });
}
