import { NextResponse } from "next/server";
import { getCurrentSession, isFromTrustedOrigin } from "@/auth/server";
import { isRecentSecondStep } from "@/two-step-verification";
import { getTwoStepVerification } from "@/two-step-verification/server";

/**
 * Renews the 10 backup codes: the old ones no longer work, the new ones come back once. It takes a second step done
 * less than 10 minutes ago in this session (ADR-0075).
 * 200 { backupCodes } · 401 · 403 { error: "forbidden" | "recent_second_step_required" } · 409 { error: "not_enabled" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getCurrentSession();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecentSecondStep(current.session.twoStepVerifiedAt)) return NextResponse.json({ error: "recent_second_step_required" }, { status: 403 });

  const backupCodes = await getTwoStepVerification().regenerateBackupCodes(current.user.id);
  if (!backupCodes) return NextResponse.json({ error: "not_enabled" }, { status: 409 });
  return NextResponse.json({ backupCodes }, { headers: { "Cache-Control": "no-store" } });
}
