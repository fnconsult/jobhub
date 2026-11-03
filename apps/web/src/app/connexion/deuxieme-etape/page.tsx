import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RETURN_PARAM } from "@/auth/sign-in-return";
import { getSessionForSecondStep, signInRedirect } from "@/auth/server";
import { SecondStepPage } from "@/components/SecondStepPage";
import { SignInStage } from "@/design/SignInStage";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { secondStepReturn } from "@/two-step-verification/gate";
import { getTwoStepVerification } from "@/two-step-verification/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("twoStep.secondStep.title")} · ${t("app.name")}` };
}

/**
 * The second step (ADR-0075, #663, #664): after a magic link, one of the Candidate's passkeys, the code of their
 * authenticator app or a backup code, before anything else. All a pending session reaches, with sign-out. Done, or with nothing pending, it goes on
 * to `?suite=`.
 */
export default async function SecondStepRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const current = await getSessionForSecondStep();
  if (!current) return signInRedirect();
  const raw = (await searchParams)[RETURN_PARAM];
  const back = secondStepReturn(typeof raw === "string" ? raw : null);
  if (!current.session.twoStepPending) redirect(back);
  const [locale, t, { factors }] = await Promise.all([getRequestLocale(), getServerT(), getTwoStepVerification().status(current.user.id)]);
  const passkey = factors.some((factor) => factor.kind === "passkey");
  const app = factors.some((factor) => factor.kind === "authenticator_app");
  return (
    <SignInStage title={t("twoStep.secondStep.title")} legalLine={false}>
      <SecondStepPage back={back} locale={locale} passkey={passkey} app={app} />
    </SignInStage>
  );
}
