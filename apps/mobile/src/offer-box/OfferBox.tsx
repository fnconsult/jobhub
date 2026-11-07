import { importanceTier, offerBoxView, postingAge, type OfferBoxDay, type OfferBoxFilter } from "@jobhub/shared";
import { DISMISSAL_REASONS, type DismissalReason, type OfferBoxEntryRead, type OfferBoxResponse } from "@jobhub/shared/reads";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Platform, View } from "react-native";
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
 * then « Précédemment » by Importance tier, each entry with « Suivre » (`POST /api/applications`) and « Écarter » (its
 * Dismissal reasons or « Écarter sans motif », `POST /api/offer-box/:id/dismissal`, #816), then the box read again; a
 * notice says it was écartée, with « Annuler » (and, when that fails, that the offer stays écartée). « Écartées », folded at the foot, each with « Revenir sur ce choix »
 * (`DELETE`). An entry opens in the Work Pane; its context menu opens its posting or shares its web address. It leads
 * the page: the menu's Coach Conversation follows it, its box at the foot (JobSearchesMenu, variant B of ADR-0090).
 */
export function OfferBox() {
  const { t } = useTranslation();
  const box = useOfferBox();
  const api = useApi();
  const queries = useQueryClient();
  /** A write, then the box read again: whether the web app answered `ok` with it. */
  const write = async (path: string, init: RequestInit, ok: number[]): Promise<boolean> => {
    const response = await api(path, init).catch(() => null);
    if (!response || !ok.includes(response.status)) return false;
    await queries.invalidateQueries({ queryKey: readKey("offerBox") });
    return true;
  };
  const dismissal = (entry: OfferBoxEntryRead) => `/api/offer-box/${encodeURIComponent(entry.id)}/dismissal`;
  const decisions: OfferBoxDecisions = {
    follow: async (entry) =>
      entry.scoredWith ? write("/api/applications", { method: "POST", body: JSON.stringify({ jobOfferId: entry.jobOffer.id, profileId: entry.scoredWith.id }) }, [200, 201]) : false,
    dismiss: (entry, reason) => write(dismissal(entry), { method: "POST", body: JSON.stringify({ reason }) }, [204]),
    reconsider: (entry) => write(dismissal(entry), { method: "DELETE" }, [204]),
  };
  if (box.data) return <OfferBoxList box={box.data} decisions={decisions} />;
  return (
    <View style={{ alignItems: "center", gap: space[2] }}>
      <ReadState read={box}>{() => null}</ReadState>
      <AppText tone="secondary">{t("offerBox.title")}</AppText>
    </View>
  );
}

/** What the Candidate decides on an entry, each answering whether it was done (the box then read again). */
export interface OfferBoxDecisions {
  follow(entry: OfferBoxEntryRead): Promise<boolean>;
  /** « Écarter », with a Dismissal reason or none. */
  dismiss(entry: OfferBoxEntryRead, reason: DismissalReason | null): Promise<boolean>;
  /** « Revenir sur ce choix », and the notice's « Annuler ». */
  reconsider(entry: OfferBoxEntryRead): Promise<boolean>;
}

/** How long the notice « … écartée. » with « Annuler » stays, as the web's toast does. */
const NOTICE_MS = 6000;
/** The notice is said politely, as the web's toast is. */
const ANNOUNCED = "polite";

/**
 * Says a notice that just appeared: `aria-live` is a live region on Android only, so iOS's VoiceOver is told it
 * (once on each platform, never twice on Android).
 */
const announce = (text: string) => {
  if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
};

/** The Offer box, filtered by a source chip (« Toutes » first). */
export function OfferBoxList({ box, decisions }: { box: OfferBoxResponse; decisions: OfferBoxDecisions }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<OfferBoxFilter>("all");
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const [notice, setNotice] = useState<OfferBoxEntryRead | null>(null);
  const [undoFailed, setUndoFailed] = useState(false);
  const view = offerBoxView(box, filter);
  useEffect(() => {
    if (!notice) return;
    announce(t("offerBox.dismissedToast", { title: notice.jobOffer.title }));
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, t]);
  useEffect(() => {
    if (undoFailed) announce(t("offerBox.undoError"));
  }, [undoFailed, t]);
  const lineDecisions: OfferBoxDecisions = {
    follow: decisions.follow,
    dismiss: async (entry, reason) => {
      setUndoFailed(false);
      const done = await decisions.dismiss(entry, reason);
      if (done) setNotice(entry);
      return done;
    },
    reconsider: decisions.reconsider,
  };
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
        {notice ? (
          <View aria-live={ANNOUNCED} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], padding: space[2], borderRadius: radius.md, backgroundColor: colors.surface }}>
            <AppText>{t("offerBox.dismissedToast", { title: notice.jobOffer.title })}</AppText>
            <Control
              label={t("offerBox.undo")}
              look="secondary"
              onPress={() => {
                const entry = notice;
                setNotice(null);
                void decisions.reconsider(entry).then((undone) => setUndoFailed(!undone));
              }}
            />
          </View>
        ) : null}
        {undoFailed ? (
          <View aria-live={ANNOUNCED}>
            <AppText tone="danger">{t("offerBox.undoError")}</AppText>
          </View>
        ) : null}
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
 * One Offer box entry: its row (opened in the Work Pane, its context menu), its facts; à traiter, « Suivre » and
 * « Écarter » (its reasons opened under it); « Écartée », its reason and « Revenir sur ce choix ».
 */
function Line({ entry, today, showDay, decisions }: { entry: OfferBoxEntryRead; today: string; showDay: boolean; decisions: OfferBoxDecisions }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const workPane = useWorkPane();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<"follow" | "dismiss" | "reconsider" | null>(null);
  const [reasonsOpen, setReasonsOpen] = useState(false);
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
  /** One decision on the entry: its failure said under it. */
  const decide = async (kind: "follow" | "dismiss" | "reconsider", run: () => Promise<boolean>) => {
    setWorking(true);
    setFailed(null);
    const done = await run();
    setWorking(false);
    setFailed(done ? null : kind);
    if (done) setReasonsOpen(false);
  };
  const follow = () => void decide("follow", () => decisions.follow(entry));
  const dismiss = (reason: DismissalReason | null) => void decide("dismiss", () => decisions.dismiss(entry, reason));
  const reconsider = () => void decide("reconsider", () => decisions.reconsider(entry));
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
      ) : entry.state === "dismissed" ? (
        <>
          <AppText tone="secondary">
            {entry.dismissalReason ? t("offerBox.dismissedWithReason", { reason: t(`offerBox.dismissalReasons.${entry.dismissalReason}`) }) : t("offerBox.dismissed")}
          </AppText>
          <View style={{ alignSelf: "flex-start" }}>
            <Control
              label={t("offerBox.reconsider")}
              accessibleName={t("offerBox.reconsiderLabel", { title: jobOffer.title })}
              look="secondary"
              disabled={working}
              onPress={reconsider}
            />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {entry.scoredWith ? (
            <Control
              label={working ? t("offerBox.following") : t("offerBox.follow")}
              accessibleName={`${t("offerBox.follow")} : ${jobOffer.title}`}
              look="primary"
              disabled={working}
              onPress={follow}
            />
          ) : null}
          <Control
            label={t("offerBox.dismiss")}
            accessibleName={t("offerBox.dismissLabel", { title: jobOffer.title })}
            look="secondary"
            expanded={reasonsOpen}
            disabled={working}
            onPress={() => setReasonsOpen(!reasonsOpen)}
          />
        </View>
      )}
      {entry.state === "to_handle" && reasonsOpen ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1], padding: space[2], borderRadius: radius.md, backgroundColor: colors.surface }}>
          <AppText variant="meta" tone="secondary">
            {t("offerBox.dismissWhy")}
          </AppText>
          {DISMISSAL_REASONS.map((reason) => (
            <Control key={reason} label={t(`offerBox.dismissalReasons.${reason}`)} look="secondary" disabled={working} onPress={() => dismiss(reason)} />
          ))}
          <Control label={t("offerBox.dismissWithoutReason")} disabled={working} onPress={() => dismiss(null)} />
        </View>
      ) : null}
      {failed ? <AppText tone="danger">{t(failed === "follow" ? "offerBox.followError" : failed === "dismiss" ? "offerBox.dismissError" : "offerBox.reconsiderError")}</AppText> : null}
    </View>
  );
}
