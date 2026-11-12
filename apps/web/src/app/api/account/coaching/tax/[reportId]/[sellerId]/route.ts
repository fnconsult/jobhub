import { NextResponse } from "next/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { getCurrentCandidate } from "@/auth/server";
import { getRequestLocale } from "@/i18n/server";
import { getCoachingTaxes } from "@/coaching-tax/server";
import { fiscalCopyPdf } from "@/coaching-tax/pdf";
export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string; sellerId: string }> }) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const person = await getCurrentCandidate();
  if (!person) return new Response(null, { status: 401 });
  const { reportId, sellerId } = await params,
    copy = await getCoachingTaxes().sellerCopy(person.id, reportId, sellerId);
  if (!copy) return new Response(null, { status: 404 });
  const pdf = await fiscalCopyPdf(copy, await getRequestLocale());
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${pdf.filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
