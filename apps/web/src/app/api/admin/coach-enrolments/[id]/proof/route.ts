import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
export async function GET(_request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    await requireBackOffice("humanCoaches");
    const proof = await getCoachEnrolments().proof((await params).id);
    if (!proof)
        notFound();
    return new Response(new Uint8Array(proof.bytes), {
        headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "content-disposition": "inline", "x-content-type-options": "nosniff" },
    });
}
