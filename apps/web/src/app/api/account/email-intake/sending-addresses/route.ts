import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getEmailIntake } from "@/email-intake/server";

async function addressIn(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as { address?: unknown } | null;
  return typeof body?.address === "string" ? body.address : null;
}

/**
 * The Candidate adds one of their own sending addresses, from which an email they forward by hand is read (#437).
 * 200 { sendingAddresses } · 400 { error: "invalid" | "too_many" } · 401 · 403
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const address = await addressIn(request);
  const added = address === null ? "invalid" : await getEmailIntake().addSendingAddress(candidate.id, address);
  if (added !== "added") return NextResponse.json({ error: added }, { status: 400 });
  return NextResponse.json({ sendingAddresses: await getEmailIntake().sendingAddresses(candidate.id) });
}

/**
 * The Candidate removes a sending address they added; their account's stays.
 * 200 { sendingAddresses } · 400 · 401 · 403
 */
export async function DELETE(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const address = await addressIn(request);
  if (address === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await getEmailIntake().removeSendingAddress(candidate.id, address);
  return NextResponse.json({ sendingAddresses: await getEmailIntake().sendingAddresses(candidate.id) });
}
