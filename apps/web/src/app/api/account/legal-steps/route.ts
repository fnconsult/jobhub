import { parisDay } from "@jobhub/help";
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { NextResponse } from "next/server";
import { legalSteps } from "@/acceptances/legal-steps";
import { pendingAcceptance } from "@/acceptances/server";
import { getCurrentCandidate } from "@/auth/server";
import { getEuAiConsents } from "@/eu-ai-consent/server";
import { getLegalTextNotices } from "@/legal-text-notices/server";
import { getRequestLocale } from "@/i18n/server";
import { publicContactEmail } from "@/public-pages/contact-email";

/**
 * What the Jobbbox app asks on its native screen after sign-in (#689): the CGU version to accept, the privacy
 * policy's change to show once, and whether the EU AI Consent is given (`legalStepsResponseSchema`), in `?lang=` (the
 * app's language) or the Candidate's Interface Language. 200 · 401
 */
export async function GET(request: Request) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const lang = new URL(request.url).searchParams.get("lang");
  const [cgu, privacyChange, euAiConsentGiven, locale] = await Promise.all([
    pendingAcceptance(candidate.id),
    getLegalTextNotices().privacyChange(candidate.id),
    getEuAiConsents().has(candidate.id),
    isSupportedLocale(lang) ? lang : getRequestLocale(),
  ]);
  const steps = legalSteps({ cgu, privacyChange, euAiConsentGiven }, locale, { on: parisDay(), contactEmail: publicContactEmail() ?? "" });
  return NextResponse.json(steps, { headers: { "cache-control": "no-store" } });
}
