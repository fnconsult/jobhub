import type { Metadata } from "next";
import Link from "next/link";
import { getSignalementsBackOffice, requireBackOffice } from "@/admin/server";
import { getBilling } from "@/billing/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { SIGNALEMENT_STATUSES, SIGNALEMENT_TYPES } from "@/signalements/values";
import { ALL_STATUSES, signalementsFilter } from "./filters";

const CURRENT = "page";
/** How much of a message the list shows; the rest is on the Signalement's own page. */
const MESSAGE_START = 120;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to those whose roles do not cover it would carry its title.
  await requireBackOffice("signalements");
  const t = await getServerT();
  return { title: `${t("admin.signalements.title")} · ${t("admin.title")}`, robots: { index: false } };
}

const start = (message: string) => (message.length > MESSAGE_START ? `${message.slice(0, MESSAGE_START).trimEnd()}…` : message);

/**
 * « Signalements » (#376), first under Candidats: what Candidates sent the team, « à traiter » (nouveau and vu) by
 * default, oldest first, filtered by type and status, each with its context and, for Support and super-admins, the
 * Candidate's email and Plan. Help editors read the Questions alone, without who sent them. No text search, no deletion;
 * the status and the reply are changed on each one's page.
 */
export default async function SignalementsPage({ searchParams }: { searchParams: Promise<{ type?: string; statut?: string }> }) {
  const { access, canWrite } = await requireBackOffice("signalements");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { type, status, statuses } = signalementsFilter(await searchParams);
  const [listed, plans] = await Promise.all([getSignalementsBackOffice().list(access, { ...(type ? { type } : {}), statuses }), canWrite ? getBilling().plans() : Promise.resolve([])]);
  const planName = (key: string) => plans.find((plan) => plan.key === key)?.name[locale] ?? key;
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

  return (
    <BackOfficeLayout access={access} title={t("admin.signalements.title")}>
      <p className="lead">{t("admin.signalements.intro")}</p>
      <p>{t("admin.signalements.noDeletion")}</p>
      {canWrite ? null : <p className="notice">{t("admin.signalements.questionsOnly")}</p>}

      {canWrite ? (
        <nav aria-label={t("admin.signalements.typeFilter")}>
          <ul className="journal-filter">
            {[undefined, ...SIGNALEMENT_TYPES].map((option) => (
              <li key={option ?? "all"}>
                <Link href={routes.adminSignalements({ ...(option ? { type: option } : {}), ...(status ? { status } : {}) })} aria-current={option === type ? CURRENT : undefined}>
                  {option ? t(`admin.signalements.types.${option}`) : t("admin.signalements.allTypes")}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <nav aria-label={t("admin.signalements.statusFilter")}>
        <ul className="journal-filter">
          {[undefined, ...SIGNALEMENT_STATUSES, ALL_STATUSES].map((option) => (
            <li key={option ?? "to-handle"}>
              <Link href={routes.adminSignalements({ ...(type ? { type } : {}), ...(option ? { status: option } : {}) })} aria-current={option === status ? CURRENT : undefined}>
                {option === undefined ? t("admin.signalements.toHandle") : option === ALL_STATUSES ? t("admin.signalements.allStatuses") : t(`admin.signalements.statuses.${option}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {listed.length === 0 ? (
        <p>{t("admin.signalements.none")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.signalements.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.signalements.type")}</th>
                <th scope="col">{t("admin.signalements.date")}</th>
                <th scope="col">{t("admin.signalements.message")}</th>
                <th scope="col">{t("admin.signalements.page")}</th>
                <th scope="col">{t("admin.signalements.version")}</th>
                <th scope="col">{t("admin.signalements.browser")}</th>
                <th scope="col">{t("admin.signalements.language")}</th>
                <th scope="col">{t("admin.signalements.textSize")}</th>
                {canWrite ? <th scope="col">{t("admin.signalements.candidate")}</th> : null}
                {canWrite ? <th scope="col">{t("admin.signalements.plan")}</th> : null}
                <th scope="col">{t("admin.signalements.status")}</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((each) => (
                <tr key={each.id}>
                  <td>{t(`admin.signalements.types.${each.type}`)}</td>
                  <td>
                    <time dateTime={each.createdAt.toISOString()}>{at.format(each.createdAt)}</time>
                  </td>
                  <th scope="row">
                    <Link href={routes.adminSignalement(each.id)} lang={each.context.interfaceLanguage}>
                      {start(each.message)}
                    </Link>
                  </th>
                  <td>{each.context.path ? <code>{each.context.path}</code> : t("admin.signalements.unknownPage")}</td>
                  <td>
                    <code>{each.context.version}</code>
                  </td>
                  <td>{each.context.browser ?? t("admin.signalements.unknownBrowser")}</td>
                  <td>{t(`languages.${each.context.interfaceLanguage}`)}</td>
                  <td>{t(`textSize.${each.context.textSize}`)}</td>
                  {canWrite ? <td>{each.candidate?.email}</td> : null}
                  {canWrite ? <td>{each.candidate ? planName(each.candidate.plan) : null}</td> : null}
                  <td>{t(`admin.signalements.statuses.${each.status}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BackOfficeLayout>
  );
}
