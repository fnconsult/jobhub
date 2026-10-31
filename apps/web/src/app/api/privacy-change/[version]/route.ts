import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getLegalTextNotices } from "@/legal-text-notices/server";

/** « J'ai compris » on the privacy policy's change (#547): closed for the Candidate, for that version; nothing else changes. 204 · 401 · 403 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/privacy-change/[version]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await getLegalTextNotices().dismissPrivacyChange(candidate.id, (await params).version);
  return new NextResponse(null, { status: 204 });
}
