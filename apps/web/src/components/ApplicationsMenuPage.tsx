import type { ApplicationStatus } from "@jobhub/shared";
import Link from "next/link";
import { applicationsMenu, type ApplicationsMenuRow } from "@/applications/menu";
import { getApplications } from "@/applications/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { ApplicationsMenuSuggestions } from "@/components/ApplicationsMenuSuggestions";
import { CoachConversationPage } from "@/components/CoachPanel";
import { Card } from "@/design/Card";
import { Pill, type Tone } from "@/design/Pill";
import { Table, type Column } from "@/design/Table";
import { getFollowUps } from "@/follow-ups/server";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type T = Awaited<ReturnType<typeof getServerT>>;

/** Mes candidatures' Subject: the menu's one conversation per Candidate (ADR-0070). */
const SUBJECT = { kind: "menu", id: "applications" } as const;
/** The card's title, which names it. */
const CARD_TITLE_ID = "applications-menu-title";

/** An Application Status's tint; its words carry the meaning. */
const STATUS_TONES: Record<ApplicationStatus, Tone> = {
  to_apply: "neutral",
  applied: "accent",
  followed_up: "accent",
  interview: "accent",
  offer_received: "success",
  accepted: "success",
  rejected: "neutral",
  abandoned: "neutral",
};

/**
 * Mes candidatures under « Conversation au centre » (#604, ADR-0070): the menu's conversation, one per Candidate, as the
 * page. Its Introduction says what the page is for; the list of Applications (status, Match Score, à traiter) is a card in
 * the thread, each line to its Application; Archived Applications are left out until asked for (`showArchived`). The
 * suggestions above the box: the Applications à traiter, « Ajouter une candidature », « Chercher des offres ».
 */
export async function ApplicationsMenuPage({ candidateId, showArchived }: { candidateId: string; showArchived: boolean }) {
  const [t, applications, notices, matchScores, subject] = await Promise.all([
    getServerT(),
    getApplications().list(candidateId),
    getFollowUps().notices(candidateId),
    getApplications().matchScores(candidateId),
    getCoachConversations().ofSubject(candidateId, SUBJECT),
  ]);
  const menu = applicationsMenu({ applications, notices, matchScores, showArchived });
  const conversationId = subject.ok ? (subject.conversation?.id ?? null) : null;
  const toHandle = menu.rows.flatMap((row) => (row.toHandle ? [{ applicationId: row.id, title: row.title, kind: row.toHandle }] : []));
  return (
    <CoachConversationPage
      key={conversationId ?? "new"}
      conversationId={conversationId}
      subject={SUBJECT}
      introduction={<p>{t("applicationsMenu.introduction")}</p>}
      card={<ApplicationsCard rows={menu.rows} toHandle={menu.toHandle} archivedHidden={menu.archivedHidden} showArchived={showArchived} t={t} />}
      suggestions={<ApplicationsMenuSuggestions toHandle={toHandle} />}
    />
  );
}

/** The list of Applications, a card in the menu's thread. */
function ApplicationsCard({ rows, toHandle, archivedHidden, showArchived, t }: { rows: ApplicationsMenuRow[]; toHandle: number; archivedHidden: number; showArchived: boolean; t: T }) {
  const columns: Column<ApplicationsMenuRow>[] = [
    {
      key: "offer",
      header: t("applications.jobOffer"),
      rowHeader: true,
      cell: (row) => <Link href={routes.application(row.id)}>{[row.title, row.employer].filter(Boolean).join(" · ")}</Link>,
    },
    { key: "status", header: t("applications.status"), cell: (row) => <Pill tone={STATUS_TONES[row.status]}>{t(`applicationStatuses.${row.status}`)}</Pill> },
    {
      key: "matchScore",
      header: t("applicationsMenu.matchScore"),
      numeric: true,
      cell: (row) =>
        row.matchScore === null ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="visually-hidden">{t("applicationsMenu.noMatchScore")}</span>
          </>
        ) : (
          row.matchScore
        ),
    },
    {
      key: "toHandle",
      header: t("applicationsMenu.toHandleColumn"),
      cell: (row) => (row.toHandle ? <Pill tone="warn">{t(row.toHandle === "follow_up" ? "applicationsMenu.followUpReady" : "applicationsMenu.noAnswer")}</Pill> : null),
    },
  ];
  return (
    <Card
      title={t("applicationsMenu.count", { count: rows.length })}
      headingId={CARD_TITLE_ID}
      actions={toHandle > 0 ? <Pill tone="warn">{t("applicationsMenu.toHandle", { count: toHandle })}</Pill> : undefined}
    >
      {rows.length === 0 ? <p>{t("applications.none")}</p> : <Table label={t("applications.title")} columns={columns} rows={rows} rowKey={(row) => row.id} data-row-links="" />}
      {archivedHidden > 0 ? (
        <p className="applications-menu-card__archived">
          {t("applications.archivedHidden", { count: archivedHidden })} <Link href={`${routes.applications}?archivees=1`}>{t("applicationsMenu.showArchived")}</Link>
        </p>
      ) : showArchived ? (
        <p className="applications-menu-card__archived">
          <Link href={routes.applications}>{t("applicationsMenu.hideArchived")}</Link>
        </p>
      ) : null}
    </Card>
  );
}
