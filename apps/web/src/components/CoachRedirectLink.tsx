import Link from "next/link";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { readTypedRedirect, redirectLine, type TypedRedirect } from "@/coach-actions/redirect-line";
import { useWorkPane } from "@/components/work-pane";
import { routes } from "@/routes";
import "./CoachRedirectLink.css";

/**
 * A reply's Typed redirect (ADR-0114), under it in the thread: where the Candidate does themselves what no Coach Action
 * does, « Profil Finance › CV de référence › Langues », one link to the page the server built. The AI model never wrote
 * it; one that is not a path of Jobbbox's is not shown. The Coach Memory's opens in the Work Pane, beside the conversation,
 * as « Mémoire du coach » does in the menu; its address opens it there from another page.
 */
export function CoachRedirectLink({ redirect }: { redirect: TypedRedirect }) {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  const shown = readTypedRedirect(redirect);
  if (!shown) return null;
  const inPane =
    workPane && shown.href === routes.coachMemory
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          workPane.open({ kind: "memory" });
        }
      : undefined;
  return (
    <p className="coach-redirect">
      <span className="coach-redirect__label">{t("coachRedirects.label")} :</span>{" "}
      <Link href={shown.href} onClick={inPane}>
        {redirectLine(shown)}
      </Link>
    </p>
  );
}
