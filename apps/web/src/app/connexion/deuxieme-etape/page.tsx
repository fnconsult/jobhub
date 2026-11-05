import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { RETURN_PARAM } from "@/auth/sign-in-return";
import { getSessionForSecondStep, signInRedirect } from "@/auth/server";
import { SecondStepPage } from "@/components/SecondStepPage";
import { SignInStage } from "@/design/SignInStage";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { secondStepReturn } from "@/two-step-verification/gate";
import { secondStepRead } from "@/two-step-verification/pending-sessions";
import { getPendingSessions } from "@/two-step-verification/proxy-gate";
import { getTwoStepVerification } from "@/two-step-verification/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("twoStep.secondStep.title")} · ${t("app.name")}` };
}

/**
 * The second step (ADR-0075, #663, #664): after a magic link, one of the Candidate's passkeys, the code of their
 * authenticator app or a backup code, before anything else. An Administrator or a Human Coach with no factor yet sets
 * up an authenticator app here instead (#665). All a pending session reaches, with sign-out. Done, or with nothing
 * pending, it goes on to `?suite=`.
 */
export default async function SecondStepRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const current = await getSessionForSecondStep();
  if (!current) return signInRedirect();
  const raw = (await searchParams)[RETURN_PARAM];
  const back = secondStepReturn(typeof raw === "string" ? raw : null);
  const pending = await getPendingSessions().of(await headers());
  if (!pending) redirect(back);
  const [locale, t, { factors }] = await Promise.all([getRequestLocale(), getServerT(), getTwoStepVerification().status(current.user.id)]);
  const read = secondStepRead(pending, factors);
  const passkey = read.step === "second_step" && read.passkey;
  const app = read.step === "second_step" && read.app;
  return (
    <SignInStage title={t("twoStep.secondStep.title")} legalLine={false}>
      <SecondStepPage step={pending.step} back={back} locale={locale} passkey={passkey} app={app} />
    </SignInStage>
  );
}
