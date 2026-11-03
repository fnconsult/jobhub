import { NextResponse } from "next/server";
import { getCurrentSession, isFromTrustedOrigin } from "@/auth/server";
import { getTwoStepVerification, tellTwoStepChange } from "@/two-step-verification/server";

/**
 * Mon compte, « Sécurité » (#664): removes one of the Candidate's passkeys. When it is their last factor, Two-step
 * verification goes off with it, which takes a second step done less than 10 minutes ago in this session (ADR-0075),
 * and the account is emailed. (Adding and renaming go through Better Auth's passkey plugin; its own deletion is refused.)
 * 200 { disabled } · 401 · 403 { error: "forbidden" | "recent_second_step_required" } · 404 { error: "not_found" }
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/account/two-step-verification/passkeys/[id]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getCurrentSession();
  if (!current) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const removed = await getTwoStepVerification().removePasskey({ candidateId: current.user.id, secondStepAt: current.session.twoStepVerifiedAt }, (await params).id);
  if (!removed.ok) return NextResponse.json({ error: removed.error }, { status: removed.error === "not_found" ? 404 : 403 });
  if (removed.disabled) await tellTwoStepChange(current.user, "disabled");
  return NextResponse.json({ disabled: removed.disabled });
}
