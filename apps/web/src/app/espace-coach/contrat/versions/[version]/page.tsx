import { legalText, parisDay, LEGAL_TEXT_DAY } from "@jobhub/help";
import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachContracts, getCoachContractWritten } from "@/coach-contracts/server";
import { ContractText } from "@/coach-contracts/ContractText";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";
export default async function Page({ params }: { params: Promise<{ version: string }> }) {
  if (!coachSpaceV2On()) notFound();
  const person = await getCurrentCandidate();
  if (!person) return signInRedirect();
  if (!(await getCoachContracts().actors(person)).length) notFound();
  const { version } = await params;
  if (!LEGAL_TEXT_DAY.test(version)) notFound();
  const locale = await getRequestLocale();
  const shown = legalText("contrat-coach", locale, { on: parisDay(), version }, getCoachContractWritten(locale));
  if (!shown) notFound();
  const t = await getServerT();
  return (
    <PublicSite>
      <main className="page stack">
        <h1>{t("coachSpaceV2.pages.contrat")}</h1>
        <ContractText shown={shown} />
      </main>
    </PublicSite>
  );
}
