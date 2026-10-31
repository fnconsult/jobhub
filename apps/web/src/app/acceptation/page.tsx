import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { acceptanceReturn } from "@/acceptances/gate";
import { pendingAcceptance } from "@/acceptances/server";
import { RETURN_PARAM } from "@/auth/sign-in-return";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AcceptanceForm } from "@/components/AcceptanceForm";
import { SignInStage } from "@/design/SignInStage";
import { getRequestLocale, getServerT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("acceptance.title")} · ${t("app.name")}` };
}

/**
 * The Acceptance screen (ADR-0062, #510): after sign-in, the CGU version a Candidate must accept before anything else
 * (the first one, then each substantial one). With nothing to accept, it goes straight on to `?suite=`.
 */
export default async function AcceptancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const raw = (await searchParams)[RETURN_PARAM];
  const back = acceptanceReturn(typeof raw === "string" ? raw : null);
  const [cgu, locale, t] = await Promise.all([pendingAcceptance(candidate.id), getRequestLocale(), getServerT()]);
  if (!cgu) redirect(back);
  return (
    <SignInStage title={t("acceptance.title")} intro={t("acceptance.intro")} legalLine={false}>
      <AcceptanceForm cgu={{ version: cgu.version, url: cgu.url }} locale={locale} back={back} />
    </SignInStage>
  );
}
