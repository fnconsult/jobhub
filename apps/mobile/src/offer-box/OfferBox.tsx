import { importanceTier, offerBoxView, postingAge, type OfferBoxDay, type OfferBoxFilter } from "@jobhub/shared";
import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useOfferBox, useOfferBoxOffer } from "../api/reads";
import { FoundJobOfferPane } from "../job-searches/FoundJobOffer";
import { openPostingAction, shareLinkAction } from "../navigation/links";
import { paths } from "../navigation/pages";
import { ReadState } from "../screens/ReadState";
import { useWorkPane } from "../shell/Shell";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { ObjectRow } from "../ui/ObjectRow";
import { OfferDecision, useDismissalNotice, useOfferBoxDecisions, type OfferBoxDecisions } from "./decisions";

/**
 * Recherches d'offres in the app (ADR-0090, #815): the Offer box (« Offres à traiter ») as `GET /api/offer-box` answers
 * it, laid out by `offerBoxView` as the web lays it out: « N à traiter » and « k traitées », the source chips, « Aujourd'hui »
 * then « Précédemment » by Importance tier, each entry with « Suivre » (`POST /api/applications`) and « Écarter » (its
 * Dismissal reasons or « Écarter sans motif », `POST /api/offer-box/:id/dismissal`, #816), then the box read again; a
 * notice says it was écartée, with « Annuler » (and, when that fails, that the offer stays écartée). « Écartées », folded at the foot, each with « Revenir sur ce choix »
 * (`DELETE`). An entry opens in the Work Pane; its context menu opens its posting or shares its web address. It leads
 * the page: the menu's Coach Conversation follows it, its box at the foot (JobSearchesMenu, variant B of ADR-0090).
 */
export function OfferBox() {
  const { t } = useTranslation();
  const box = useOfferBox();
  const decisions = useOfferBoxDecisions();
  if (box.data) return <OfferBoxList box={box.data} decisions={decisions} />;
  return (
    <View style={{ alignItems: "center", gap: space[2] }}>
      <ReadState read={box}>{() => null}</ReadState>
      <AppText tone="secondary">{t("offerBox.title")}</AppText>
    </View>
  );
}

/** The Offer box, filtered by a source chip (« Toutes » first). */
export function OfferBoxList({ box, decisions }: { box: OfferBoxResponse; decisions: OfferBoxDecisions }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<OfferBoxFilter>("all");
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const view = offerBoxView(box, filter);
  const { decisions: lineDecisions, notice } = useDismissalNotice(decisions);
  return (
    <View style={{ gap: space[4] }}>
      <View style={{ gap: space[2] }}>
        <AppText variant="h2" heading>
          {t("offerBox.title")}
        </AppText>
        <AppText tone="secondary">{`${view.toHandle} ${t("offerBox.toHandle")} · ${t("offerBox.treated", { count: view.treated })}`}</AppText>
        <View style={{ height: 6, borderRadius: radius.md, backgroundColor: colors.hover, overflow: "hidden" }}>
          <View style={{ height: 6, width: `${view.toHandle + view.treated === 0 ? 100 : Math.round((100 * view.treated) / (view.toHandle + view.treated))}%`, backgroundColor: colors.success }} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }} aria-label={t("offerBox.chips")}>
          {view.chips.map(({ source, toHandle }) => (
            <Control
              key={source}
              label={`${t(`offerBox.sources.${source}`)} ${toHandle}`}
              accessibleName={t("offerBox.chipCount", { source: t(`offerBox.sources.${source}`), count: toHandle })}
              look="secondary"
              selected={filter === source}
              onPress={() => setFilter(source)}
            />
          ))}
        </View>
        {notice}
      </View>
      {box.entries.length === 0 ? (
        <View style={{ gap: space[1] }}>
          <AppText weight="semiBold">{t("offerBox.empty")}</AppText>
          <AppText tone="secondary">{t("offerBox.emptyText")}</AppText>
        </View>
      ) : (
        <>
          <Day name={t("offerBox.today")} day={view.today} today={box.today} nothing={t("offerBox.nothingToday")} followed={(count) => t("offerBox.followedToday", { count })} decisions={lineDecisions} />
          <Day
            name={t("offerBox.earlier")}
            day={view.earlier}
            today={box.today}
            nothing={t("offerBox.nothingEarlier")}
            followed={(count) => t("offerBox.followedEarlier", { count })}
            decisions={lineDecisions}
            showDay
          />
        </>
      )}
      {view.dismissed.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Control label={t("offerBox.dismissedBlock", { count: view.dismissed.length })} expanded={dismissedOpen} onPress={() => setDismissedOpen(!dismissedOpen)} />
          {dismissedOpen ? (
            <>
              <AppText tone="secondary">{t("offerBox.dismissedHint")}</AppText>
              {view.dismissed.map((entry) => (
                <Line key={entry.id} entry={entry} today={box.today} showDay decisions={lineDecisions} />
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** « Aujourd'hui » or « Précédemment »: its tiers, then its entries already suivies, folded. */
function Day({
  name,
  day,
  today,
  nothing,
  followed,
  decisions,
  showDay = false,
}: {
  name: string;
  day: OfferBoxDay;
  today: string;
  nothing: string;
  followed: (count: number) => string;
  decisions: OfferBoxDecisions;
  showDay?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space[3] }}>
      <AppText variant="h3" heading>
        {name}
      </AppText>
      {day.tiers.length === 0 ? <AppText tone="secondary">{nothing}</AppText> : null}
      {day.tiers.map(({ tier, entries }) => (
        <View key={tier} style={{ gap: space[2] }}>
          <AppText variant="meta" weight="semiBold" tone="secondary" heading>
            {t(`offerBox.tiers.${tier}`)}
          </AppText>
          {entries.map((entry) => (
            <Line key={entry.id} entry={entry} today={today} showDay={showDay} decisions={decisions} />
          ))}
        </View>
      ))}
      {day.followed.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Control label={followed(day.followed.length)} expanded={open} onPress={() => setOpen(!open)} />
          {open ? day.followed.map((entry) => <Line key={entry.id} entry={entry} today={today} showDay={showDay} decisions={decisions} />) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One Offer box entry: its row (opened in the Work Pane, its context menu), its facts, where it stands and what can be
 * decided (OfferDecision).
 */
function Line({ entry, today, showDay, decisions }: { entry: OfferBoxEntryRead; today: string; showDay: boolean; decisions: OfferBoxDecisions }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const workPane = useWorkPane();
  const { jobOffer } = entry;
  const tier = importanceTier(entry.matchScore);
  const label = [jobOffer.title, jobOffer.employer].filter(Boolean).join(" · ");
  const age = postingAge({ postedAt: jobOffer.postedAt, firstArrivalAt: entry.firstArrivalAt }, today);
  const arrivedOn = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(`${entry.arrivalDay}T12:00:00Z`));
  const score = entry.matchScore === null ? t("offerBox.noScore") : t("offerBox.score", { score: entry.matchScore });
  const facts = [jobOffer.location, jobOffer.contractType ? t(`cvReview.contractTypes.${jobOffer.contractType}`) : null].filter(Boolean).join(" · ");
  const tags = [
    showDay ? t("offerBox.arrivedOn", { date: arrivedOn }) : null,
    ...entry.sources.map(({ source }) => t(`offerBox.sources.${source}`)),
    age.postedDaysAgo === null ? null : age.postedDaysAgo === 0 ? t("offerBox.postedToday") : t("offerBox.postedAgo", { count: age.postedDaysAgo }),
    age.leavesInDays === null ? null : t("offerBox.leavesIn", { count: age.leavesInDays }),
    entry.profile?.name ?? t("offerBox.unsorted"),
  ].filter(Boolean);
  const open = () =>
    workPane.open({
      title: jobOffer.title,
      content: entry.scoredWith ? (
        <EntryPane entryId={entry.id} />
      ) : (
        <View style={{ gap: space[2] }}>
          <AppText weight="semiBold">{score}</AppText>
          {facts ? <AppText tone="secondary">{facts}</AppText> : null}
        </View>
      ),
    });
  return (
    <View
      aria-label={jobOffer.title}
      style={{
        gap: space[1],
        padding: space[2],
        borderRadius: radius.card,
        borderWidth: tier === "not_to_miss" && entry.state === "to_handle" ? 2 : 1,
        borderColor: tier === "not_to_miss" && entry.state === "to_handle" ? colors.success : colors.border,
        backgroundColor: entry.state === "followed" ? colors.surface : colors.background,
      }}
    >
      <ObjectRow
        label={label}
        onPress={open}
        actions={[
          { label: t("mobile.rowMenu.open"), onPress: open },
          ...(jobOffer.url ? [openPostingAction(t("mobile.rowMenu.openPosting"), jobOffer.url)] : []),
          shareLinkAction(t("mobile.rowMenu.shareLink"), paths.offerBoxOffer(jobOffer.id)),
        ]}
      />
      <AppText weight="semiBold" tone={tier === "not_to_miss" ? "success" : tier === "to_look_at" ? "warn" : "secondary"}>
        {score}
      </AppText>
      {facts ? <AppText tone="secondary">{facts}</AppText> : null}
      <AppText variant="meta" tone="secondary">
        {tags.join(" · ")}
      </AppText>
      <OfferDecision entry={entry} decisions={decisions} />
    </View>
  );
}

/**
 * An entry opened in the Work Pane (#692), as a Job Search's Job Offer opens (FoundJobOfferPane): its text and why its
 * Match Score, against the Profile « Suivre » saves it with, read when it opens (`GET /api/offer-box/:id`).
 */
function EntryPane({ entryId }: { entryId: string }) {
  const read = useOfferBoxOffer(entryId);
  return <ReadState read={read}>{({ found, profile }) => <FoundJobOfferPane found={found} profile={profile} />}</ReadState>;
}
