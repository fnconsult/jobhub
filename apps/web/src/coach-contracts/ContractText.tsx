import { writtenDay } from "@/public-pages/days";
import Link from "next/link";
import type { ShownLegalText } from "@jobhub/help";
import { CoachReplyText } from "@/components/CoachReplyText";
import { getServerT } from "@/i18n/server";
/** Private rendering: no links into public /legal, no public sidebar or public PDF endpoint. */
export async function ContractText({ shown }: { shown: ShownLegalText }) {
  const t = await getServerT(),
    version = shown.version;
  return (
    <article className="coach-space-card stack">
      <h2>{version.title}</h2>
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
    </article>
  );
}
