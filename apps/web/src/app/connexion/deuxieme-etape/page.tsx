import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RETURN_PARAM } from "@/auth/sign-in-return";
import { getSessionForSecondStep, signInRedirect } from "@/auth/server";
import { SecondStepPage } from "@/components/SecondStepPage";
import { SignInStage } from "@/design/SignInStage";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { secondStepReturn } from "@/two-step-verification/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("twoStep.secondStep.title")} · ${t("app.name")}` };
}

/**
 * The second step (ADR-0075, #663): after a magic link, the code of the Candidate's authenticator app or a backup
 * code, before anything else. All a pending session reaches, with sign-out. Done, or with nothing pending, it goes on
 * to `?suite=`.
 */
export default async function SecondStepRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const current = await getSessionForSecondStep();
  if (!current) return signInRedirect();
  const raw = (await searchParams)[RETURN_PARAM];
  const back = secondStepReturn(typeof raw === "string" ? raw : null);
  if (!current.session.twoStepPending) redirect(back);
  const [locale, t] = await Promise.all([getRequestLocale(), getServerT()]);
  return (
    <SignInStage title={t("twoStep.secondStep.title")} legalLine={false}>
      <SecondStepPage back={back} locale={locale} />
    </SignInStage>
  );
}
