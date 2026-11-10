import { sharedPool } from "@/database/pool";
import { getCurrentCandidate } from "@/auth/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachEarnings } from "@/coaching-earnings/server";
import { earningsPdf } from "@/coaching-earnings/pdf";
import { getRequestLocale } from "@/i18n/server";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { contentDisposition } from "@/export";
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { COACHING_DEFAULT_ZONE } from "@jobhub/shared/coaching-time";
/** An authenticated export of owned business records, like Account Data; it grants no coaching access. */
export async function GET(request: Request, { params }: { params: Promise<{ sellerId: string }> }) {
  if (!coachSpaceV2On()) return Response.json({ error: "not_found" }, { status: 404 });
  const person = await getCurrentCandidate();
  if (!person) return Response.json({ error: "unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams,
    sellerId = (await params).sellerId,
    statement = await getCoachEarnings().statement(person.id, sellerId, query.get("mois") ?? undefined);
  if (!statement) return Response.json({ error: "not_found" }, { status: 404 });
  const language = query.get("lang"),
    locale = isSupportedLocale(language) ? language : await getRequestLocale(),
    coachId = (await sharedPool().query<{ coachId: string | null }>('SELECT coach_id AS "coachId" FROM coaching_seller WHERE id=$1', [sellerId])).rows[0]
      ?.coachId;
  const timeZone = coachId ? await getCoachingTimeZones().coach(coachId) : ((await getCoachingTimeZones().candidate(person.id)) ?? COACHING_DEFAULT_ZONE);
  const pdf = await earningsPdf(statement, locale, timeZone);
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": contentDisposition(pdf.fileName),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
