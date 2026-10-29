import Link from "next/link";
import type { ReactNode } from "react";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "./SignInStage.css";

const TERMS = routes.legal("conditions-utilisation");
const PRIVACY = routes.legal("confidentialite");

/**
 * A sign-in page's stage (#470, prototype `#connexion`): a centred column on the accent-tinted canvas, the logo, the
 * `title` and `intro`, the `notices` (Notes: a failed sign-in, the Back Office's SSO required), the form in a card,
 * then the legal line, its links leading to the Légal page.
 */
export async function SignInStage({ title, intro, notices, children }: { title: ReactNode; intro?: ReactNode; notices?: ReactNode; children: ReactNode }) {
  const t = await getServerT();
  return (
    <main id="main" className="ds-sign-in">
      <div className="ds-sign-in__column">
        <span className="ds-sign-in__logo" aria-hidden>
          {t("app.name").charAt(0)}
        </span>
        <h1 className="ds-sign-in__title">{title}</h1>
        {intro ? <p className="ds-sign-in__intro">{intro}</p> : null}
        {notices}
        <div className="ds-sign-in__card">{children}</div>
        <p className="ds-sign-in__legal">
          {t("signIn.legalLine.before")} <Link href={TERMS}>{t("signIn.legalLine.terms")}</Link>{" "}
          {t("signIn.legalLine.between")} <Link href={PRIVACY}>{t("signIn.legalLine.privacy")}</Link>
          {t("signIn.legalLine.after")}
        </p>
      </div>
    </main>
  );
}
