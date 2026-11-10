import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuth, getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachEnrolments } from "@/coach-enrolments/server";
import { PROOF_MAX_BYTES } from "@/coach-enrolments";
import { enrolmentFormData } from "@/coach-enrolments/http";
export async function POST(request: Request) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const secret = getAuth().options.secret;
  if (typeof secret !== "string") throw new Error("Auth secret is required");
  // The reverse proxy supplies X-Real-IP; no raw address is retained or written to the application log.
  const key = createHmac("sha256", secret)
    .update(request.headers.get("x-real-ip") ?? "unknown")
    .digest("hex");
  const enrolments = getCoachEnrolments();
  if (!(await enrolments.allowSubmission(key))) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const form = await enrolmentFormData(request, PROOF_MAX_BYTES + 65536);
  if (!form) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const proof = form.get("proof");
  if (!(proof instanceof File) || proof.size > PROOF_MAX_BYTES) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const person = await getCurrentCandidate();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const result = await enrolments.submit(
    {
      kind: form.get("kind"),
      contactName: form.get("contactName"),
      legalName: form.get("legalName"),
      email,
      status: form.get("status"),
      siret: form.get("siret"),
      specialties: String(form.get("specialties") ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      languages: String(form.get("languages") ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      presentation: form.get("presentation"),
      locale: form.get("locale"),
    },
    { name: proof.name, bytes: new Uint8Array(await proof.arrayBuffer()) },
    person,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "invalid" ? 400 : 503 });
  // No public account or application enumeration, and no second email for a duplicate request.
  return NextResponse.json({ ok: true, confirmed: Boolean(person?.emailVerified && person.email.toLowerCase() === email) }, { status: 201 });
}
