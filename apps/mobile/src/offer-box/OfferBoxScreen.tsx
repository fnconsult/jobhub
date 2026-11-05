import { importanceTier, offerBoxView, postingAge, type OfferBoxDay, type OfferBoxFilter } from "@jobhub/shared";
import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { useApi } from "../api/api";
import { useOfferBox } from "../api/reads";
import { openPostingAction, shareLinkAction } from "../navigation/links";
import { paths } from "../navigation/pages";
import { readKey } from "../offline/read-cache";
import { ReadState } from "../screens/ReadState";
import { useWorkPane } from "../shell/Shell";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { ObjectRow } from "../ui/ObjectRow";

/**
 * Recherches d'offres in the app (ADR-0090, #815): the Offer box (« Offres à traiter ») as `GET /api/offer-box` answers
 * it, laid out by `offerBoxView` as the web lays it out: « N à traiter » and « k traitées », the source chips, « Aujourd'hui »
 * then « Précédemment » by Importance tier, each entry with « Suivre » (`POST /api/applications`, then the box read
 * again). An entry opens in the Work Pane; its context menu opens its posting or shares its web address. The coach's box
 * at the foot comes with #690.
 */
export function OfferBoxScreen() {
  const { t } = useTranslation();
  const box = useOfferBox();
  const api = useApi();
  const queries = useQueryClient();
  const follow = async (entry: OfferBoxEntryRead): Promise<boolean> => {
    if (!entry.scoredWith) return false;
    const response = await api("/api/applications", { method: "POST", body: JSON.stringify({ jobOfferId: entry.jobOffer.id, profileId: entry.scoredWith.id }) }).catch(() => null);
    if (!response || (response.status !== 200 && response.status !== 201)) return false;
    await queries.invalidateQueries({ queryKey: readKey("offerBox") });
    return true;
  };
  if (box.data) return <OfferBoxList box={box.data} onFollow={follow} />;
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: space[4] }}>
      <ReadState read={box}>{() => null}</ReadState>
      <AppText tone="secondary">{t("offerBox.title")}</AppText>
    </View>
  );
}

/** The Offer box, filtered by a source chip (« Toutes » first). */
export function OfferBoxList({ box, onFollow }: { box: OfferBoxResponse; onFollow: (entry: OfferBoxEntryRead) => Promise<boolean> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<OfferBoxFilter>("all");
  const view = offerBoxView(box, filter);
  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4] }}>
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
      </View>
      {box.entries.length === 0 ? (
        <View style={{ gap: space[1] }}>
          <AppText weight="semiBold">{t("offerBox.empty")}</AppText>
          <AppText tone="secondary">{t("offerBox.emptyText")}</AppText>
        </View>
      ) : (
        <>
          <Day name={t("offerBox.today")} day={view.today} today={box.today} nothing={t("offerBox.nothingToday")} followed={(count) => t("offerBox.followedToday", { count })} onFollow={onFollow} />
          <Day
            name={t("offerBox.earlier")}
            day={view.earlier}
            today={box.today}
            nothing={t("offerBox.nothingEarlier")}
            followed={(count) => t("offerBox.followedEarlier", { count })}
            onFollow={onFollow}
            showDay
          />
        </>
      )}
    </ScrollView>
  );
}

/** « Aujourd'hui » or « Précédemment »: its tiers, then its entries already suivies, folded. */
function Day({
  name,
  day,
  today,
  nothing,
  followed,
  onFollow,
  showDay = false,
}: {
  name: string;
  day: OfferBoxDay;
  today: string;
  nothing: string;
  followed: (count: number) => string;
  onFollow: (entry: OfferBoxEntryRead) => Promise<boolean>;
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
            <Line key={entry.id} entry={entry} today={today} showDay={showDay} onFollow={onFollow} />
          ))}
        </View>
      ))}
      {day.followed.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Control label={followed(day.followed.length)} expanded={open} onPress={() => setOpen(!open)} />
          {open ? day.followed.map((entry) => <Line key={entry.id} entry={entry} today={today} showDay={showDay} onFollow={onFollow} />) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One Offer box entry: its row (opened in the Work Pane, its context menu), its facts, « Suivre ». */
function Line({ entry, today, showDay, onFollow }: { entry: OfferBoxEntryRead; today: string; showDay: boolean; onFollow: (entry: OfferBoxEntryRead) => Promise<boolean> }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const workPane = useWorkPane();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
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
      content: (
        <View style={{ gap: space[2] }}>
          <AppText weight="semiBold">{score}</AppText>
          {facts ? <AppText tone="secondary">{facts}</AppText> : null}
          <AppText tone="secondary">{t("mobile.jobOfferPlaceholder")}</AppText>
        </View>
      ),
    });
  const follow = async () => {
    setWorking(true);
    setFailed(false);
    const followed = await onFollow(entry);
    setWorking(false);
    setFailed(!followed);
  };
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
      {entry.state === "followed" ? (
        <AppText tone="success">{t("offerBox.followed")}</AppText>
      ) : entry.scoredWith ? (
        <View style={{ alignSelf: "flex-start" }}>
          <Control label={working ? t("offerBox.following") : t("offerBox.follow")} accessibleName={`${t("offerBox.follow")} : ${jobOffer.title}`} look="primary" disabled={working} onPress={() => void follow()} />
        </View>
      ) : null}
      {failed ? <AppText tone="danger">{t("offerBox.followError")}</AppText> : null}
    </View>
  );
}
