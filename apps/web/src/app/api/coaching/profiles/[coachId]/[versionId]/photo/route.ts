import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCoachPages } from "@/coach-pages/server";
/** Only the currently approved portrait is served, to signed-in readers, never a pending or replaced upload. */
export async function GET(_request: Request, { params }: {
    params: Promise<{
        coachId: string;
        versionId: string;
    }>;
}) {
    if (!(await getCurrentCandidate()))
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { coachId, versionId } = await params, photo = await getCoachPages().photo(coachId, versionId);
    return photo
        ? new Response(new Uint8Array(photo), {
            headers: { "content-type": "image/webp", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
        })
        : NextResponse.json({ error: "not_found" }, { status: 404 });
}
