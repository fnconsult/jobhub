import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuth, getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getContentReports } from "@/coaching-content-reports/server";
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const secret = getAuth().options.secret;
  if (typeof secret !== "string") throw Error("Auth secret required");
  const reports = getContentReports(),
    key = createHmac("sha256", secret)
      .update(request.headers.get("x-real-ip") ?? "unknown")
      .digest("hex");
  if (!(await reports.allowSubmission(key))) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "invalid" }, { status: 400 });
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 32768) {
      await reader.cancel();
      return NextResponse.json({ error: "invalid" }, { status: 413 });
    }
    text += decoder.decode(part.value, { stream: true });
  }
  text += decoder.decode();
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const result = await reports.submit(input, await getCurrentCandidate());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
  await reports.deliverNotices(result.id);
  return NextResponse.json(result, { status: 201 });
}
