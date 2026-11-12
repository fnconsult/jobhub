import {
  applicationsResponseSchema,
  jobDigestsResponseSchema,
  jobSearchesResponseSchema,
  type ApplicationRow,
} from "@jobhub/shared/reads";
import { useRouter } from "expo-router";
import {
  Briefcase,
  Calendar,
  MessageSquare,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { AgendaList } from "../agenda/AgendaList";
import { systemSheets } from "../agenda/system-sheets";
import { useAgenda, useRead } from "../api/reads";
import { CoachConversation, useCoachBox } from "../coach/CoachConversation";
import { HumanCoaches } from "../coaching/HumanCoaches";
import { HomeCard, useHasProfile } from "../home/HomeCard";
import { StartJobSearch } from "../job-searches/StartJobSearch";
import type { SubjectRef } from "../coach/coach-reply";
import { shareLinkAction } from "../navigation/links";
import { paths } from "../navigation/pages";
import { OfferBox } from "../offer-box/OfferBox";
import { OfferBoxFilterArea } from "../offer-box/filter";
import { ReadState } from "../screens/ReadState";
import { radius, space, useTheme } from "../theme/theme";
import { AppText, CappedTextScale, ROW_MAX_SCALE } from "../ui/AppText";
import { Control } from "../ui/Control";
import { ObjectRow } from "../ui/ObjectRow";

type MenuId =
  | "applications"
  | "jobSearches"
  | "jobDigests"
  | "agenda"
  | "humanCoaches";
const menu = (id: MenuId): SubjectRef => ({ kind: "menu", id });
/** Each menu's Subject: its one conversation per Candidate. */
const SUBJECTS = {
  applications: menu("applications"),
  jobSearches: menu("jobSearches"),
  jobDigests: menu("jobDigests"),
  agenda: menu("agenda"),
  humanCoaches: menu("humanCoaches"),
} as const;

/** The read of Mes candidatures with the Archived Applications in it: kept apart from the one without. */
const ARCHIVED_SHOWN = "archivees";

/** How many of the Applications à traiter are suggested, the most recent first (as on the web). */
const SUGGESTED_TO_HANDLE = 2;

/**
 * The home page and the Sidebar's menus as their Coach Conversations (ADR-0070, #604), as on the web: each menu's
 * conversation is its Subject's, one per Candidate; its Introduction (no AI call) after the AI disclosure; its content a
 * card in the thread, read by the GETs of #684; its suggestions above the box until the first message.
 */

/**
 * The home page: a new Free conversation (#979), its AI disclosure in short words, then « Votre point du jour », what
 * calls for the Candidate's action today, or « Pour commencer » while they have no Profile; the Quick actions above the
 * box once they have one.
 */
export function HomePage({ onSaved }: { onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const hasProfile = useHasProfile();
  return (
    <CoachConversation
      conversationId={null}
      route={paths.home}
      shortDisclosure
      onSaved={(saved) => onSaved(saved.id)}
      introduction={
        <>
          {hasProfile === false ? <AppText>{t("mobile.home.start.intro")}</AppText> : <AppText>{t("mobile.home.ask")}</AppText>}
          <HomeCard hasProfile={hasProfile} />
        </>
      }
      suggestions={hasProfile === false ? null : <QuickActions />}
    />
  );
}

/** « Chercher des offres », « Ajouter une candidature » (the box, for a Job Offer link), « Planifier un entretien », « Demander au coach ». */
function QuickActions() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Suggestions>
      <Control
        label={t("quickActions.searchJobOffers")}
        icon={Search}
        look="primary"
        onPress={() => router.navigate(paths.jobSearches)}
      />
      <InTheBox label={t("quickActions.addApplication")} icon={Plus} />
      <Control
        label={t("quickActions.scheduleInterview")}
        icon={Calendar}
        look="secondary"
        onPress={() => router.navigate(paths.agenda)}
      />
      <InTheBox label={t("quickActions.askCoach")} icon={MessageSquare} />
    </Suggestions>
  );
}

/** A suggestion that puts the focus in the box, for the Candidate to write (a Job Offer's link to save, a question). */
function InTheBox({ label, icon }: { label: string; icon: LucideIcon }) {
  const box = useCoachBox();
  return (
    <Control label={label} icon={icon} look="secondary" onPress={box.focus} />
  );
}

/** The suggestions above the box, a row that wraps. */
function Suggestions({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <View
      role="group"
      aria-label={t("quickActions.label")}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: space[2],
        paddingBottom: space[1],
      }}
    >
      {children}
    </View>
  );
}

/** A menu's content in its thread: a card, its title naming it. */
function MenuCard({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        gap: space[2],
        padding: space[4],
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <AppText variant="h3">{title}</AppText>
      {children}
    </View>
  );
}

/** A card's read: what it says while it loads, or when it could not be read. */
function Loaded<T>({
  read,
  failed,
  children,
}: {
  read: { data: T | undefined; isError: boolean };
  /** What the card says when the read failed, if not the menus' own words. */
  failed?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (read.data !== undefined) return <>{children(read.data)}</>;
  if (read.isError && failed) return <>{failed}</>;
  return (
    <AppText tone="secondary">
      {t(read.isError ? "coachPanel.listErrors.load" : "coachPanel.loading")}
    </AppText>
  );
}

/** A line of a card: a row leading to the page `to` (its context menu shares it), and what goes with it. */
function Line({ label, meta, to }: { label: string; meta?: string; to: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const open = () => router.navigate(to);
  return (
    <View>
      <ObjectRow label={label} onPress={open} actions={[{ label: t("mobile.rowMenu.open"), onPress: open }, shareLinkAction(t("mobile.rowMenu.shareLink"), to)]} />
      {meta ? (
        <View style={{ paddingHorizontal: space[3] }}>
          <AppText variant="meta" tone="secondary">
            {meta}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Mes candidatures: the list of Applications (status, Match Score, à traiter), each to its conversation. The Archived
 * Applications are left out until the Candidate asks for them (« Les afficher », `GET /api/applications?archivees=1`),
 * as on the web.
 */
export function ApplicationsMenu() {
  const { t } = useTranslation();
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const read = useRead(
    "applications",
    showArchived ? "/api/applications?archivees=1" : "/api/applications",
    applicationsResponseSchema,
    showArchived ? [ARCHIVED_SHOWN] : [],
  );
  const label = (row: ApplicationRow) =>
    [row.title, row.employer].filter(Boolean).join(" · ");
  const toHandle = read.data?.applications.filter((row) => row.toHandle) ?? [];
  return (
    <CoachConversation
      conversationId={null}
      subject={SUBJECTS.applications}
      route={paths.applications}
      introduction={<AppText>{t("applicationsMenu.introduction")}</AppText>}
      card={
        <MenuCard
          title={t("applicationsMenu.count", {
            count: read.data?.applications.length ?? 0,
          })}
        >
          <Loaded read={read}>
            {(data) =>
              data.applications.length === 0 ? (
                <AppText>{t("applications.none")}</AppText>
              ) : (
                <>
                  {data.toHandle > 0 ? (
                    <AppText tone="warn">
                      {t("applicationsMenu.toHandle", { count: data.toHandle })}
                    </AppText>
                  ) : null}
                  {data.applications.map((row) => {
                    const open = () =>
                      router.navigate(paths.application(row.id));
                    return (
                      <View key={row.id}>
                        <ObjectRow
                          label={label(row)}
                          icon={Briefcase}
                          onPress={open}
                          actions={[
                            { label: t("mobile.rowMenu.open"), onPress: open },
                            shareLinkAction(
                              t("mobile.rowMenu.shareLink"),
                              paths.application(row.id),
                            ),
                          ]}
                        />
                        <CappedTextScale scale={ROW_MAX_SCALE}>
                        <AppText variant="meta" tone="secondary">
                          {[
                            t(`applicationStatuses.${row.status}`),
                            `${t("applicationsMenu.matchScore")} ${row.matchScore ?? t("applicationsMenu.noMatchScore")}`,
                            row.toHandle
                              ? t(
                                  row.toHandle === "follow_up"
                                    ? "applicationsMenu.followUpReady"
                                    : "applicationsMenu.noAnswer",
                                )
                              : null,
                            row.expired ? t("applications.expired") : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </AppText>
                        </CappedTextScale>
                      </View>
                    );
                  })}
                </>
              )
            }
          </Loaded>
          {read.data && read.data.archivedHidden > 0 ? (
            <View style={{ gap: space[1], alignItems: "flex-start" }}>
              <AppText tone="secondary">
                {t("applications.archivedHidden", {
                  count: read.data.archivedHidden,
                })}
              </AppText>
              <Control
                label={t("applicationsMenu.showArchived")}
                look="secondary"
                onPress={() => setShowArchived(true)}
              />
            </View>
          ) : showArchived && read.data ? (
            <View style={{ alignItems: "flex-start" }}>
              <Control
                label={t("applicationsMenu.hideArchived")}
                look="secondary"
                onPress={() => setShowArchived(false)}
              />
            </View>
          ) : null}
        </MenuCard>
      }
      suggestions={
        <Suggestions>
          {toHandle.slice(0, SUGGESTED_TO_HANDLE).map((row) => (
            <Control
              key={row.id}
              label={t(
                row.toHandle === "follow_up"
                  ? "followUps.noticeFollowUp"
                  : "followUps.noticeAbandon",
                { title: row.title },
              )}
              look="secondary"
              onPress={() => router.navigate(paths.application(row.id))}
            />
          ))}
          <InTheBox label={t("quickActions.addApplication")} icon={Plus} />
          <Control
            label={t("quickActions.searchJobOffers")}
            icon={Search}
            look="secondary"
            onPress={() => router.navigate(paths.jobSearches)}
          />
        </Suggestions>
      }
    />
  );
}

/**
 * Recherches d'offres (ADR-0090, variant B): the Offer box (« Offres à traiter ») leads the page, the menu's conversation
 * following it with its box at the foot (on a phone, the box's header behind the Top Bar's filter icon, OfferBoxFilterArea,
 * #899); in it, each active Profile's Job Searches, most recent first, each opening on its Job Offers (#692), then
 * « Lancer une recherche » (#699): the screen's only way to launch a Job Search, kept in the card so no screen drops it.
 */
export function JobSearchesMenu() {
  const { t, i18n } = useTranslation();
  const read = useRead(
    "jobSearches",
    "/api/job-searches",
    jobSearchesResponseSchema,
  );
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "long",
    timeZone: "Europe/Paris",
  });
  return (
    <OfferBoxFilterArea>
      <CoachConversation
        conversationId={null}
        subject={SUBJECTS.jobSearches}
        route={paths.jobSearches}
        lead={<OfferBox />}
        introduction={<AppText>{t("jobSearchesMenu.introduction")}</AppText>}
        card={
          <MenuCard title={t("jobSearchesMenu.title")}>
            <Loaded read={read}>
              {(data) =>
                data.profiles.length === 0 ? (
                  <AppText>{t("jobSearchesPage.noActiveProfile")}</AppText>
                ) : (
                  data.profiles.map(({ profile, searches }) => (
                    <View key={profile.id} style={{ gap: space[1] }}>
                      <AppText weight="semiBold">{profile.name}</AppText>
                      {searches.length === 0 ? (
                        <AppText tone="secondary">
                          {t("jobSearchesMenu.none")}
                        </AppText>
                      ) : null}
                      {searches.map((search) => (
                        <Line
                          key={search.id}
                          label={t("jobSearchesPage.latestOn", {
                            date: date.format(new Date(search.startedAt)),
                          })}
                          to={paths.jobSearch(search.id)}
                          meta={[
                            `${t("jobSearchesMenu.found")} : ${search.found}`,
                            search.status === "searching"
                              ? t("jobSearchesMenu.stillSearching")
                              : null,
                            search.unseen ? t("jobSearchesMenu.unseen") : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                      ))}
                    </View>
                  ))
                )
              }
            </Loaded>
            <StartJobSearch />
          </MenuCard>
        }
      />
    </OfferBoxFilterArea>
  );
}

/**
 * Job Digests: each active Profile's frequency, then its Job Digests sent, newest first, with how many Job Offers each
 * lists; each opens on its Job Offers (#692).
 */
export function JobDigestsMenu() {
  const { t, i18n } = useTranslation();
  const read = useRead(
    "jobDigests",
    "/api/job-digests",
    jobDigestsResponseSchema,
  );
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "full",
    timeZone: "Europe/Paris",
  });
  return (
    <CoachConversation
      conversationId={null}
      subject={SUBJECTS.jobDigests}
      route={paths.jobDigests}
      introduction={<AppText>{t("jobDigestsMenu.introduction")}</AppText>}
      card={
        <MenuCard title={t("jobDigestsMenu.title")}>
          <Loaded read={read}>
            {(data) =>
              data.profiles.map(({ profile, frequency, digests }) => (
                <View key={profile.id} style={{ gap: space[1] }}>
                  <AppText weight="semiBold">{profile.name}</AppText>
                  <AppText tone="secondary">
                    {frequency === "none"
                      ? t("mobile.jobDigests.off")
                      : t("mobile.jobDigests.frequency", {
                          frequency: t(`jobDigest.frequencyOptions.${frequency}`),
                        })}
                  </AppText>
                  {digests.length === 0 ? (
                    <AppText tone="secondary">
                      {t("jobDigestsMenu.none")}
                    </AppText>
                  ) : null}
                  {digests.map((digest) => (
                    <Line
                      key={digest.id}
                      label={`${t("jobDigestsMenu.sentOn")} ${date.format(new Date(digest.sentAt))}`}
                      to={paths.jobDigest(digest.id)}
                      meta={`${t("jobDigestsMenu.count")} : ${digest.count}`}
                    />
                  ))}
                </View>
              ))
            }
          </Loaded>
        </MenuCard>
      }
    />
  );
}

/**
 * The Agenda as a list (src/agenda/AgendaList, #693): « À planifier » first, then by day (ADR-0076), each Item with
 * « Ajouter à mon calendrier »; « Ajouter un entretien » suggested.
 */
export function AgendaMenu() {
  const { t } = useTranslation();
  const read = useAgenda();
  return (
    <CoachConversation
      conversationId={null}
      subject={SUBJECTS.agenda}
      route={paths.agenda}
      introduction={<AppText>{t("agendaMenu.introduction")}</AppText>}
      card={
        <MenuCard title={t("agendaMenu.title")}>
          {/* Loading, failing and offline as every read shows them (ReadState), in the Agenda's own words. */}
          <ReadState read={read} loading={t("agenda.loading")} failed={t("agenda.loadError")}>
            {(data) => <AgendaList agenda={data} sheets={systemSheets} scrolls={false} />}
          </ReadState>
        </MenuCard>
      }
      suggestions={
        <Suggestions>
          <InTheBox label={t("agendaMenu.addInterview")} icon={Plus} />
        </Suggestions>
      }
    />
  );
}

/**
 * Mes coachs humains: the Coaching Sessions, then the Human Coaches to book (src/coaching/HumanCoaches, #694): each to
 * book and pay, its date to enter, « Renoncer au contrat ici » while it can be withdrawn from.
 */
export function HumanCoachesMenu() {
  const { t } = useTranslation();
  return (
    <CoachConversation
      conversationId={null}
      subject={SUBJECTS.humanCoaches}
      route={paths.humanCoaches}
      introduction={<AppText>{t("humanCoachesMenu.introduction")}</AppText>}
      card={<HumanCoaches />}
    />
  );
}
