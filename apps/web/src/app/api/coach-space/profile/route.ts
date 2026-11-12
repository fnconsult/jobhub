import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getCoachPages } from "@/coach-pages/server";
import { COACH_PHOTO_MAX_BYTES } from "@/coach-pages/limits";
import { boundedFormData } from "@/uploads/bounded-form-data";
export async function POST(request: Request) {
    requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0107): this route answers 404.
    if (!isFromTrustedOrigin(request))
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const person = await getCurrentCandidate();
    if (!person)
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const coach = await getHumanCoaches().coachSignedIn(person);
    if (!coach)
        return NextResponse.json({ error: "not_found" }, { status: 404 });
    const form = await boundedFormData(request, COACH_PHOTO_MAX_BYTES + 65536);
    if (!form)
        return NextResponse.json({ error: "invalid" }, { status: 400 });
    if (form.get("coachId") !== coach.id)
        return NextResponse.json({ error: "not_found" }, { status: 404 });
    let content: unknown;
    try {
        content = JSON.parse(String(form.get("content")));
    }
    catch {
        return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    const photo = form.get("photo"), bytes = photo instanceof File && photo.size ? new Uint8Array(await photo.arrayBuffer()) : undefined;
    const result = await getCoachPages().submit(coach.id, { basedOn: Number(form.get("basedOn")), content, photoAction: form.get("photoAction"), locale: form.get("locale") }, bytes);
    return NextResponse.json(result, { status: result.ok ? 201 : result.error === "conflict" ? 409 : result.error === "not_found" ? 404 : 400 });
}
