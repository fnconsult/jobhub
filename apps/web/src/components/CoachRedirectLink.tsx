import Link from "next/link";
import { useTranslation } from "react-i18next";
import { readTypedRedirect, redirectLine, type TypedRedirect } from "@/coach-actions/redirect-line";
import "./CoachRedirectLink.css";

/**
 * A reply's Typed redirect (ADR-0114), under it in the thread: where the Candidate does themselves what no Coach Action
 * does, « Profil Finance › CV de référence › Langues », one link to the page the server built. The AI model never wrote
 * it; one that is not a path of Jobbbox's is not shown.
 */
export function CoachRedirectLink({ redirect }: { redirect: TypedRedirect }) {
  const { t } = useTranslation();
  const shown = readTypedRedirect(redirect);
  if (!shown) return null;
  return (
    <p className="coach-redirect">
      <span className="coach-redirect__label">{t("coachRedirects.label")} :</span> <Link href={shown.href}>{redirectLine(shown)}</Link>
    </p>
  );
}
