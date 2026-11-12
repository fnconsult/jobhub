import { writtenDay } from "@/public-pages/days";
import Link from "next/link";
import type { ShownLegalText } from "@jobhub/help";
import { CoachReplyText } from "@/components/CoachReplyText";
import { Card } from "@/design/Card";
import { getServerT } from "@/i18n/server";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
/** Private rendering: no links into public /legal, no public sidebar or public PDF endpoint. */
export async function ContractText({ shown }: { shown: ShownLegalText }) {
  const t = await getServerT(),
    version = shown.version;
  return (
    <Card as={ARTICLE} title={version.title}>
      <div className="stack">
        {version.locale !== "fr" ? (
          <p>
            {t("legal.translation")} <Link href={`/espace-coach/contrat/versions/${version.effective}?lang=fr`}>{t("legal.readFrench")}</Link>
          </p>
        ) : null}
        <p>{t(shown.upcoming ? "legal.effectiveFrom" : "legal.effective", { date: writtenDay(version.effective, version.locale) })}</p>
        {!shown.inEffect && !shown.upcoming ? <p>{t("legal.archived")}</p> : null}
        {version.inBrief.length ? (
          <ul>
            {version.inBrief.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {version.sections.map((section) => (
          <section key={section.id}>
            <h3 id={section.id}>
              {section.number}. {section.title}
            </h3>
            <CoachReplyText text={section.body} />
          </section>
        ))}
        <p>{t("legal.approvedBy", { name: version.approvedBy, date: writtenDay(version.effective, version.locale) })}</p>
      </div>
    </Card>
  );
}
