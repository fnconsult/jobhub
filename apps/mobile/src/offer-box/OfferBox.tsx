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
 * notice says it was écartée, with « Annuler » (and, when that fails, that the offer stays écartée), and « Plus tard »
 * (`POST /api/offer-box/:id/later`, #817: away until Monday, still counted; a notice with « Annuler », its `DELETE`). Each
 * tier of « Précédemment » with two entries or more offers « Tout écarter (n) » (`POST /api/offer-box/dismissals`, those
 * the source chip shows, without a reason; a notice with « Annuler », its `DELETE`). Folded at the foot: « Plus tard »
 * (each « revient lundi n »), « Expirées sans décision » (out of the count, « Écarter » only) and « Écartées », each with
 * « Revenir sur ce choix » (`DELETE`). An entry opens in the Work Pane; its context menu opens its posting or shares its web address. It leads
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
  /** A write whose answer says something (200), then the box read again: that answer, or null. */
  const ask = async (path: string, init: RequestInit): Promise<Record<string, unknown> | null> => {
    const response = await api(path, init).catch(() => null);
    if (!response || response.status !== 200) return null;
    const json: unknown = await response.json().catch(() => null);
    await queries.invalidateQueries({ queryKey: readKey("offerBox") });
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  };
  const dismissal = (entry: OfferBoxEntryRead) => `/api/offer-box/${encodeURIComponent(entry.id)}/dismissal`;
  const later = (entry: OfferBoxEntryRead) => `/api/offer-box/${encodeURIComponent(entry.id)}/later`;
  const decisions: OfferBoxDecisions = {
    follow: async (entry) =>
      entry.scoredWith ? write("/api/applications", { method: "POST", body: JSON.stringify({ jobOfferId: entry.jobOffer.id, profileId: entry.scoredWith.id }) }, [200, 201]) : false,
    dismiss: (entry, reason) => write(dismissal(entry), { method: "POST", body: JSON.stringify({ reason }) }, [204]),
    reconsider: (entry) => write(dismissal(entry), { method: "DELETE" }, [204]),
    later: async (entry) => {
      const answer = await ask(later(entry), { method: "POST" });
      return typeof answer?.laterUntil === "string" ? answer.laterUntil : null;
    },
    cancelLater: (entry) => write(later(entry), { method: "DELETE" }, [204]),
    dismissAll: async (entries) => {
      const answer = await ask("/api/offer-box/dismissals", { method: "POST", body: JSON.stringify({ entryIds: entries.map((entry) => entry.id) }) });
      return Array.isArray(answer?.dismissed) ? answer.dismissed.filter((id): id is string => typeof id === "string") : null;
    },
    reconsiderAll: (entryIds) => write("/api/offer-box/dismissals", { method: "DELETE", body: JSON.stringify({ entryIds }) }, [204]),
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
  /** « Plus tard » (#817): the Monday 00:00 Paris time it comes back, or null when it was not done. */
  later(entry: OfferBoxEntryRead): Promise<string | null>;
  /** The « Plus tard » notice's « Annuler ». */
  cancelLater(entry: OfferBoxEntryRead): Promise<boolean>;
  /** « Tout écarter (n) » (#817): the ids it écarta, or null when it was not done. */
  dismissAll(entries: OfferBoxEntryRead[]): Promise<string[] | null>;
  /** The « Tout écarter » notice's « Annuler »: the ids it écarta, à traiter again. */
  reconsiderAll(entryIds: string[]): Promise<boolean>;
}

/** What the notice says of what was just done, and its « Annuler »: what it undoes, and what it says when that fails. */
interface Notice {
  message: string;
  undo: () => Promise<boolean>;
  undoError: string;
}

/** « Tout écarter (n) » is offered on a tier of « Précédemment » from this many entries, as on the web. */
const DISMISS_ALL_FROM = 2;

/** A day as the Offer box writes it, in French time: « 9 nov. ». */
const parisDate = (instant: string, language: string) => new Intl.DateTimeFormat(language, { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(instant));

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
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<OfferBoxFilter>("all");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [undoFailed, setUndoFailed] = useState<string | null>(null);
  const view = offerBoxView(box, filter);
  useEffect(() => {
    if (!notice) return;
    announce(notice.message);
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (undoFailed) announce(undoFailed);
  }, [undoFailed]);
  /** A decision whose notice offers « Annuler »: the notice shown once it is done. */
  const noticed = async <T,>(run: () => Promise<T | null>, notice: (done: T) => Notice): Promise<T | null> => {
    setUndoFailed(null);
    const done = await run();
    if (done !== null) setNotice(notice(done));
    return done;
  };
  const lineDecisions: OfferBoxDecisions = {
    ...decisions,
    dismiss: async (entry, reason) =>
      (await noticed(
        async () => ((await decisions.dismiss(entry, reason)) ? true : null),
        () => ({ message: t("offerBox.dismissedToast", { title: entry.jobOffer.title }), undo: () => decisions.reconsider(entry), undoError: t("offerBox.undoError") }),
      )) !== null,
    later: (entry) =>
      noticed(
        () => decisions.later(entry),
        (laterUntil) => ({
          message: t("offerBox.laterToast", { title: entry.jobOffer.title, date: parisDate(laterUntil, i18n.language) }),
          undo: () => decisions.cancelLater(entry),
          undoError: t("offerBox.laterUndoError"),
        }),
      ),
    dismissAll: (entries) =>
      noticed(
        () => decisions.dismissAll(entries),
        (dismissed) => ({ message: t("offerBox.dismissedAllToast", { count: dismissed.length }), undo: () => decisions.reconsiderAll(dismissed), undoError: t("offerBox.undoAllError") }),
      ),
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
            <AppText>{notice.message}</AppText>
            <Control
              label={t("offerBox.undo")}
              look="secondary"
              onPress={() => {
                const { undo, undoError } = notice;
                setNotice(null);
                void undo().then((undone) => setUndoFailed(undone ? null : undoError));
              }}
            />
          </View>
        ) : null}
        {undoFailed ? (
          <View aria-live={ANNOUNCED}>
            <AppText tone="danger">{undoFailed}</AppText>
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
            dismissAll
          />
        </>
      )}
      <Folded summary={t("offerBox.laterBlock", { count: view.later.length })} hint={t("offerBox.laterHint")} entries={view.later} today={box.today} decisions={lineDecisions} />
      <Folded summary={t("offerBox.expiredBlock", { count: view.expired.length })} hint={t("offerBox.expiredHint")} entries={view.expired} today={box.today} decisions={lineDecisions} />
      <Folded summary={t("offerBox.dismissedBlock", { count: view.dismissed.length })} hint={t("offerBox.dismissedHint")} entries={view.dismissed} today={box.today} decisions={lineDecisions} />
    </View>
  );
}

/** « Plus tard », « Expirées sans décision » or « Écartées »: folded at the foot of the box, absent when empty. */
function Folded({ summary, hint, entries, today, decisions }: { summary: string; hint: string; entries: OfferBoxEntryRead[]; today: string; decisions: OfferBoxDecisions }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <View style={{ gap: space[2] }}>
      <Control label={summary} expanded={open} onPress={() => setOpen(!open)} />
      {open ? (
        <>
          <AppText tone="secondary">{hint}</AppText>
          {entries.map((entry) => (
            <Line key={entry.id} entry={entry} today={today} showDay decisions={decisions} />
          ))}
        </>
      ) : null}
    </View>
  );
}

/** « Tout écarter (n) » on a tier of « Précédemment » (#817), its failure said under it. */
function DismissAll({ entries, tierName, decisions }: { entries: OfferBoxEntryRead[]; tierName: string; decisions: OfferBoxDecisions }) {
  const { t } = useTranslation();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const dismissAll = async () => {
    setWorking(true);
    setFailed(false);
    const done = await decisions.dismissAll(entries);
    setWorking(false);
    setFailed(done === null);
  };
  return (
    <View style={{ alignSelf: "flex-start", gap: space[1] }}>
      <Control
        label={t("offerBox.dismissAll", { count: entries.length })}
        accessibleName={t("offerBox.dismissAllLabel", { tier: tierName, count: entries.length })}
        disabled={working}
        onPress={() => void dismissAll()}
      />
      {failed ? <AppText tone="danger">{t("offerBox.dismissAllError")}</AppText> : null}
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
  dismissAll = false,
}: {
  name: string;
  day: OfferBoxDay;
  today: string;
  nothing: string;
  followed: (count: number) => string;
  decisions: OfferBoxDecisions;
  showDay?: boolean;
  dismissAll?: boolean;
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
          {dismissAll && entries.length >= DISMISS_ALL_FROM ? <DismissAll entries={entries} tierName={t(`offerBox.tiers.${tier}`)} decisions={decisions} /> : null}
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

/** What a decision that failed says under its entry. */
const FAILURES = { follow: "offerBox.followError", dismiss: "offerBox.dismissError", reconsider: "offerBox.reconsiderError", later: "offerBox.laterError" } as const;

/**
 * One Offer box entry: its row (opened in the Work Pane, its context menu), its facts; à traiter, « Suivre » and
 * « Écarter » (its reasons opened under it); « Écartée », its reason and « Revenir sur ce choix ».
 */
function Line({ entry, today, showDay, decisions }: { entry: OfferBoxEntryRead; today: string; showDay: boolean; decisions: OfferBoxDecisions }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const workPane = useWorkPane();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<"follow" | "dismiss" | "reconsider" | "later" | null>(null);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const { jobOffer } = entry;
  const tier = importanceTier(entry.matchScore);
  const label = [jobOffer.title, jobOffer.employer].filter(Boolean).join(" · ");
  const age = postingAge({ postedAt: jobOffer.postedAt, firstArrivalAt: entry.firstArrivalAt }, today);
  const arrivedOn = parisDate(`${entry.arrivalDay}T12:00:00Z`, i18n.language);
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
  const decide = async (kind: "follow" | "dismiss" | "reconsider" | "later", run: () => Promise<boolean>) => {
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
  const later = () => void decide("later", async () => (await decisions.later(entry)) !== null);
  const undecided = entry.state === "to_handle" || entry.state === "later" || entry.state === "expired";
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
      {entry.state === "later" && entry.laterUntil ? <AppText tone="accent">{t("offerBox.laterUntil", { date: parisDate(entry.laterUntil, i18n.language) })}</AppText> : null}
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
          {entry.state !== "expired" && entry.scoredWith ? (
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
          {entry.state === "to_handle" ? (
            <Control label={t("offerBox.later")} accessibleName={t("offerBox.laterLabel", { title: jobOffer.title })} look="secondary" disabled={working} onPress={later} />
          ) : null}
        </View>
      )}
      {undecided && reasonsOpen ? (
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
      {failed ? <AppText tone="danger">{t(FAILURES[failed])}</AppText> : null}
    </View>
  );
}
