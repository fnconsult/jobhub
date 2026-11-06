import type { JobSearchResponse } from "@jobhub/shared/reads";
import { ExternalLink, RotateCw } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useJobSearch, useProfile } from "../api/reads";
import { paths } from "../navigation/pages";
import { SearchCriteriaList } from "../profiles/SearchCriteriaList";
import { ReadState } from "../screens/ReadState";
import { useWorkPane } from "../shell/Shell";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { SessionWebPage } from "../web-pages/WebPageScreen";
import { FoundJobOffers } from "./FoundJobOffer";
import { StartRefusalNotice, useStartJobSearch, type StartRefusal } from "./StartJobSearch";

const TIME_ZONE = "Europe/Paris";
/** How it stands is announced when it changes, without interrupting. */
const ANNOUNCED = "polite";

/** The Job Search's status in words; the colour only reinforces it, as the web's pill (STATUS_TONE). */
const STATUS_TONE = { searching: "secondary", done: "success", failed: "danger", stopped: "secondary" } as const;

/**
 * A Job Search's page in the app (#692), as the web's card of it: its status, when it started, the Search Criteria its
 * Match Scores are against (to read: « Modifier les critères » opens the Profile's web page in the Work Pane), how it
 * stands, « Relancer une recherche » once it has ended, then its Job Offers, each opened in the Work Pane. While it
 * searches, the page reads it again by itself.
 */
export function JobSearchPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const read = useJobSearch(id);
  return (
    <ReadState read={read} notFound={t("mobile.jobSearches.notFound")}>
      {(search) => <JobSearchView search={search} />}
    </ReadState>
  );
}

function JobSearchView({ search }: { search: JobSearchResponse }) {
  const { t, i18n } = useTranslation();
  const { profile, status, jobOffers } = search;
  const startedAt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeStyle: "short", timeZone: TIME_ZONE }).format(new Date(search.startedAt));
  return (
    <View style={{ gap: space[4] }}>
      <AppText variant="h2" heading>
        {t("jobSearch.title", { profile: profile.name })}
      </AppText>
      <Card>
        <Prop label={t("jobSearch.status")}>
          <AppText weight="semiBold" tone={STATUS_TONE[status]}>
            {t(`jobSearch.statuses.${status}`)}
          </AppText>
        </Prop>
        <Prop label={t("jobSearch.startedOn")}>
          <AppText>{startedAt}</AppText>
        </Prop>
        <Criteria profile={profile} />
        <Outcome search={search} />
        {status === "searching" ? null : <Relaunch profileId={profile.id} />}
      </Card>
      {jobOffers.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <AppText variant="h3" heading>
            {t("jobSearch.resultsLabel")}
          </AppText>
          <FoundJobOffers jobOffers={jobOffers} profile={profile} share={(jobOfferId) => paths.jobOffer(search.id, jobOfferId)} />
        </View>
      ) : null}
    </View>
  );
}

/** The Search Criteria the Job Search's Match Scores are against, to read; they change on the Profile's web page. */
function Criteria({ profile }: { profile: { id: string; name: string } }) {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  const read = useProfile(profile.id);
  const edit = () =>
    workPane.open({ title: t("jobSearch.criteriaDialog.title", { profile: profile.name }), fill: true, content: <SessionWebPage path={paths.profile(profile.id)} /> });
  return (
    <Prop label={t("jobSearch.criteria")}>
      <ReadState read={read}>{(loaded) => <SearchCriteriaList criteria={loaded.searchCriteria} />}</ReadState>
      <View style={{ alignSelf: "flex-start" }}>
        <Control label={t("jobSearch.editCriteria")} icon={ExternalLink} look="secondary" onPress={edit} />
      </View>
      <AppText variant="meta" tone="meta">
        {t("mobile.jobSearches.criteriaOnWeb")}
      </AppText>
    </Prop>
  );
}

/** How the Job Search stands, as the web's JobSearchOutcome says it: in a live region. */
function Outcome({ search }: { search: JobSearchResponse }) {
  const { t } = useTranslation();
  const { status, jobOffers } = search;
  const found = jobOffers.length;
  const lines = [
    status === "searching" ? t("jobSearch.searching") : null,
    status === "failed" ? t("jobSearch.failed") : null,
    status === "failed"
      ? `${t(`jobSearch.failureReasons.${search.failure ?? "other"}`)}${found > 0 ? ` ${t("jobSearch.keptBeforeFailure", { count: found })}` : ""} ${t("jobSearch.notCounted")}`
      : null,
    status === "stopped" ? t("jobSearch.stopped", { count: found }) : null,
    status === "done" && found === 0 ? t("jobSearch.noResults") : null,
    found > 0 ? t("jobSearch.resultsIntro", { count: found }) : null,
  ].filter((line): line is string => line !== null);
  return (
    <View role="status" aria-live={ANNOUNCED} style={{ gap: space[1] }}>
      {lines.map((line) => (
        <AppText key={line} tone="secondary">
          {line}
        </AppText>
      ))}
    </View>
  );
}

/**
 * « Relancer une recherche »: a new Job Search for the same Profile, against its Plan Quota (ADR-0032); refused once it
 * is spent, said as the web says it, with nothing to buy (ADR-0076). Started, its page opens and the app asks for Push
 * notifications in context (useStartJobSearch, #699).
 */
function Relaunch({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const start = useStartJobSearch();
  const [working, setWorking] = useState(false);
  const [refusal, setRefusal] = useState<StartRefusal | null>(null);
  const relaunch = async () => {
    setWorking(true);
    setRefusal(null);
    const refused = await start(profileId);
    setWorking(false);
    setRefusal(refused);
  };
  return (
    <View style={{ gap: space[2], alignItems: "flex-start" }}>
      <Control label={working ? t("jobSearch.starting") : t("jobSearch.searchAgain")} icon={RotateCw} look="secondary" disabled={working} onPress={() => void relaunch()} />
      {refusal ? <StartRefusalNotice refusal={refusal} /> : null}
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ gap: space[3], padding: space[4], borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>{children}</View>;
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[1] }}>
      <AppText variant="meta" weight="semiBold" tone="secondary">
        {label}
      </AppText>
      {children}
    </View>
  );
}
