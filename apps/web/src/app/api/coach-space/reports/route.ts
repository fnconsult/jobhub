import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getSessionReports } from "@/coach-space/reports-server";
export async function POST(request: Request) {
    if (!isFromTrustedOrigin(request))
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const person = await getCurrentCandidate();
    if (!person)
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const coach = await getHumanCoaches().coachSignedIn(person);
    if (!coach)
        return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = await request.json().catch(() => null);
    const reports = getSessionReports();
    if (body?.action === "publish") {
        if (typeof body.reportId !== "string")
            return NextResponse.json({ error: "invalid" }, { status: 400 });
        const result = await reports.publish(coach.id, body.reportId, body.revision);
        return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "conflict" ? 409 : 400 });
    }
    if (typeof body?.sessionId !== "string")
        return NextResponse.json({ error: "invalid" }, { status: 400 });
    const report = await reports.save(coach.id, body.sessionId, body.fields);
    return NextResponse.json(report ? { ok: true, report } : { error: "invalid" }, { status: report ? 200 : 400 });
}
