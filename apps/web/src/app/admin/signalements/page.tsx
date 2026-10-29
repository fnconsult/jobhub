import type { Metadata } from "next";
import Link from "next/link";
import type { IntroPage } from "@/admin/page-intro";
import { getSignalementsBackOffice, requireBackOffice } from "@/admin/server";
import { getBilling } from "@/billing/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { FilterLinks } from "@/design/FilterLinks";
import { Pill, Status, type StatusTone, type Tone } from "@/design/Pill";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { SIGNALEMENT_STATUSES, SIGNALEMENT_TYPES } from "@/signalements/values";
import { ALL_STATUSES, signalementsFilter } from "./filters";
import "../section.css";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "signalements";

/** The filters' ids for « Tous les types » and « À traiter », which the address leaves out. */
const ALL = "all";
const TO_HANDLE = "to-handle";

type Listed = Awaited<ReturnType<ReturnType<typeof getSignalementsBackOffice>["list"]>>[number];

/** A type's tint, its words saying it. */
const TYPE_TONE: Record<(typeof SIGNALEMENT_TYPES)[number], Tone> = { bug: "danger", idee: "accent", question: "neutral" };
/** Where a Signalement stands: new ones stand out, handled ones are done. */
const STATUS_TONE: Record<(typeof SIGNALEMENT_STATUSES)[number], StatusTone> = { nouveau: "warn", vu: "neutral", traite: "success" };
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
      <div className="section-page">
        <PageIntro t={t} page={INTRO} subject={t("admin.signalements.title")}>
          {canWrite ? null : <p>{t("admin.signalements.questionsOnly")}</p>}
        </PageIntro>

        {canWrite ? (
          <FilterLinks
            label={t("admin.signalements.typeFilter")}
            shown={type ?? ALL}
            links={[undefined, ...SIGNALEMENT_TYPES].map((option) => ({
              id: option ?? ALL,
              href: routes.adminSignalements({ ...(option ? { type: option } : {}), ...(status ? { status } : {}) }),
              label: option ? t(`admin.signalements.types.${option}`) : t("admin.signalements.allTypes"),
            }))}
          />
        ) : null}
        <FilterLinks
          label={t("admin.signalements.statusFilter")}
          shown={status ?? TO_HANDLE}
          links={[undefined, ...SIGNALEMENT_STATUSES, ALL_STATUSES].map((option) => ({
            id: option ?? TO_HANDLE,
            href: routes.adminSignalements({ ...(type ? { type } : {}), ...(option ? { status: option } : {}) }),
            label: option === undefined ? t("admin.signalements.toHandle") : option === ALL_STATUSES ? t("admin.signalements.allStatuses") : t(`admin.signalements.statuses.${option}`),
          }))}
        />

        {listed.length === 0 ? (
          <p>{t("admin.signalements.none")}</p>
        ) : (
          <Table
            label={t("admin.signalements.caption")}
            columns={[
              { header: t("admin.signalements.type"), cell: (each) => <Pill tone={TYPE_TONE[each.type]}>{t(`admin.signalements.types.${each.type}`)}</Pill> },
              { header: t("admin.signalements.date"), cell: (each) => <time dateTime={each.createdAt.toISOString()}>{at.format(each.createdAt)}</time> },
              {
                header: t("admin.signalements.message"),
                rowHeader: true,
                cell: (each) => (
                  <Link href={routes.adminSignalement(each.id)} lang={each.context.interfaceLanguage}>
                    {start(each.message)}
                  </Link>
                ),
              },
              { header: t("admin.signalements.page"), cell: (each) => (each.context.path ? <code>{each.context.path}</code> : t("admin.signalements.unknownPage")) },
              { header: t("admin.signalements.version"), cell: (each) => <code>{each.context.version}</code> },
              { header: t("admin.signalements.browser"), cell: (each) => each.context.browser ?? t("admin.signalements.unknownBrowser") },
              { header: t("admin.signalements.language"), cell: (each) => t(`languages.${each.context.interfaceLanguage}`) },
              { header: t("admin.signalements.textSize"), cell: (each) => t(`textSize.${each.context.textSize}`) },
              ...(canWrite
                ? [
                    { header: t("admin.signalements.candidate"), cell: (each: Listed) => each.candidate?.email },
                    { header: t("admin.signalements.plan"), cell: (each: Listed) => (each.candidate ? planName(each.candidate.plan) : null) },
                  ]
                : []),
              { header: t("admin.signalements.status"), cell: (each) => <Status tone={STATUS_TONE[each.status]}>{t(`admin.signalements.statuses.${each.status}`)}</Status> },
            ]}
            rows={listed}
            rowKey={(each) => each.id}
          />
        )}
      </div>
    </BackOfficeLayout>
  );
}
