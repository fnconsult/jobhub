import type { LegalTextVersion } from "@jobhub/help";
import { legalTextNoticeEmail } from "../legal-text-notices/email";
export function coachContractNoticeEmail(version: LegalTextVersion, locale: string, baseURL: string) {
  const language = locale === "en" ? "en" : "fr";
  return legalTextNoticeEmail(
    {
      version,
      versionUrl: new URL(`/espace-coach/contrat/versions/${version.effective}?lang=${language}`, baseURL).toString(),
      historyUrl: new URL(`/espace-coach/contrat?lang=${language}`, baseURL).toString(),
    },
    language,
  );
}
