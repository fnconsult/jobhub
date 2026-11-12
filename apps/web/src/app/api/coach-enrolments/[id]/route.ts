import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
export async function POST(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0106): this route answers 404.
    if (!isFromTrustedOrigin(request))
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const person = await getCurrentCandidate();
    if (!person)
        return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = await request.json().catch(() => null);
    const { id } = await params;
    const enrolments = getCoachEnrolments();
    const ok = body?.action === "withdraw" ? await enrolments.withdraw(person, id) : body?.action === "confirm" ? Boolean(await enrolments.confirm(person, id)) : false;
    return NextResponse.json(ok ? { ok: true } : { error: "not_found" }, { status: ok ? 200 : 404 });
}
