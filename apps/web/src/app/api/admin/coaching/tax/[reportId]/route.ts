import { getBackOffice, requireBackOffice } from "@/admin/server";
import { getCoachingTaxes } from "@/coaching-tax/server";
export async function GET(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { administrator } = await requireBackOffice("humanCoaches", "write"),
    { reportId } = await params,
    report = await getCoachingTaxes().annual(reportId);
  if (!report) return new Response(null, { status: 404 });
  const query = new URL(request.url).searchParams,
    draft = query.get("draft") === "1",
    reconciliation = query.get("reconciliation") === "1";
  if (!draft && !reconciliation && (!report.schemaValid || report.supersededAt)) return new Response(null, { status: 409 });
  await getBackOffice().record(
    administrator,
    async () => report,
    () => ({
      section: "human_coaches",
      target: reportId,
      action: "viewed",
      before: null,
      after: { fiscalYear: report.document.year, exportKind: reconciliation ? "reconciliation" : draft ? "draft" : "xml", schemaValid: report.schemaValid },
    }),
  );
  if (reconciliation)
    return new Response(
      JSON.stringify(
        {
          year: report.document.year,
          preparedAt: report.document.createdAt,
          supersededAt: report.supersededAt,
          sellers: report.document.sellers.map((seller) => ({ sellerId: seller.sellerId, legalName: seller.identity.legalName, quarters: seller.quarters })),
        },
        null,
        2,
      ),
      {
        headers: {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="dac7-reconciliation-${report.document.year}.json"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  return new Response(report.xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="${report.supersededAt ? "SUPERSEDED-" : ""}${draft ? "DRAFT-" : ""}${report.filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
