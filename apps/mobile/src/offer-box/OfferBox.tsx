import { importanceTier, offerBoxView, postingAge, type OfferBoxDay } from "@jobhub/shared";
import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Animated, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useOfferBox, useOfferBoxOffer } from "../api/reads";
import { FoundJobOfferPane } from "../job-searches/FoundJobOffer";
import { openPostingAction, shareLinkAction } from "../navigation/links";
import { paths } from "../navigation/pages";
import { ReadState } from "../screens/ReadState";
import { useThreadScroll } from "../conversation/Conversation";
import { useWorkPane } from "../shell/Shell";
import { useFocusTopBarPrimary } from "../shell/top-bar";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText, BAR_MAX_SCALE, CappedTextScale, ROW_MAX_SCALE, WHOLE_FROM_FONT_SCALE } from "../ui/AppText";
import { Control } from "../ui/Control";
import { ObjectRow } from "../ui/ObjectRow";
import { OfferDecision, parisDate, useDismissalNotice, useOfferBoxDecisions, type OfferBoxDecisions } from "./decisions";
import { OfferBoxHeader, useOfferBoxFilter } from "./filter";

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
  const decisions = useOfferBoxDecisions();
  if (box.data) return <OfferBoxList box={box.data} decisions={decisions} />;
  return (
    <View style={{ alignItems: "center", gap: space[2] }}>
      <ReadState read={box}>{() => null}</ReadState>
      <AppText tone="secondary">{t("offerBox.title")}</AppText>
    </View>
  );
}

/**
 * The Offer box, filtered by a source chip (« Toutes » first). On a phone, in Recherches d'offres' page (#899, as the
 * web's #898), its header (count, progress, chips) is behind the compact Top Bar's filter icon (OfferBoxFilterArea), its
 * heading kept for screen readers; « Aujourd'hui » says « n arrivées aujourd'hui · N à traiter », and the tier whose
 * entries are in view stays pinned at the top of the thread, on one line, with « Tout écarter (n) » whole. A notice's
 * « Annuler » then puts the focus back on the filter icon (or « … »), in view, never on the hidden heading.
 */
export function OfferBoxList({ box, decisions }: { box: OfferBoxResponse; decisions: OfferBoxDecisions }) {
  const { t } = useTranslation();
  const { filter, setFilter, inTopBar } = useOfferBoxFilter();
  const focusPrimary = useFocusTopBarPrimary();
  const view = offerBoxView(box, filter);
  const { decisions: lineDecisions, notice } = useDismissalNotice(decisions, inTopBar ? focusPrimary : undefined);
  const thread = useThreadScroll();
  const [origin, onLayout] = useLaidOutAt(inTopBar ? (thread?.top ?? null) : null);
  return (
    <PinOrigin.Provider value={origin}>
      <View onLayout={onLayout} style={{ gap: space[4] }}>
        {inTopBar ? (
          // Behind the filter icon: its heading alone, for screen readers, drawn nowhere.
          <View style={VISUALLY_HIDDEN}>
            <AppText variant="h2" heading>
              {t("offerBox.title")}
            </AppText>
          </View>
        ) : (
          <OfferBoxHeader view={view} filter={filter} onChoose={setFilter} />
        )}
        {notice}
        {box.entries.length === 0 ? (
          <View style={{ gap: space[1] }}>
            <AppText weight="semiBold">{t("offerBox.empty")}</AppText>
            <AppText tone="secondary">{t("offerBox.emptyText")}</AppText>
          </View>
        ) : (
          <>
            <Day
              name={t("offerBox.today")}
              line={inTopBar ? t("offerBox.todayLine", { count: view.arrivedToday, toHandle: view.toHandle }) : undefined}
              day={view.today}
              today={box.today}
              nothing={t("offerBox.nothingToday")}
              followed={(count) => t("offerBox.followedToday", { count })}
              decisions={lineDecisions}
              pinned={inTopBar}
            />
            <Day
              name={t("offerBox.earlier")}
              day={view.earlier}
              today={box.today}
              nothing={t("offerBox.nothingEarlier")}
              followed={(count) => t("offerBox.followedEarlier", { count })}
              decisions={lineDecisions}
              pinned={inTopBar}
              showDay
              dismissAll
            />
          </>
        )}
        <Folded summary={t("offerBox.laterBlock", { count: view.later.length })} hint={t("offerBox.laterHint")} entries={view.later} today={box.today} decisions={lineDecisions} />
        <Folded summary={t("offerBox.expiredBlock", { count: view.expired.length })} hint={t("offerBox.expiredHint")} entries={view.expired} today={box.today} decisions={lineDecisions} />
        <Folded summary={t("offerBox.dismissedBlock", { count: view.dismissed.length })} hint={t("offerBox.dismissedHint")} entries={view.dismissed} today={box.today} decisions={lineDecisions} />
      </View>
    </PinOrigin.Provider>
  );
}

/** Drawn nowhere, read by VoiceOver and TalkBack. */
const VISUALLY_HIDDEN = { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 } as const;

/**
 * Where the view laid out by `onLayout` starts in the thread's content: its parent's (`parent`: PinOrigin, or the
 * thread's content for the box itself) plus its own place in it. Null until both are laid out, or outside a pinning box.
 */
const PinOrigin = createContext<number | null>(null);
function useLaidOutAt(parent: number | null): [number | null, (event: LayoutChangeEvent) => void] {
  const [layout, setLayout] = useState<{ y: number; height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setLayout((was) => (was?.y === y && was.height === height ? was : { y, height }));
  };
  return [parent === null || layout === null ? null : parent + layout.y, onLayout];
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

/** « Tout écarter (n) » is offered on a tier of « Précédemment » from this many entries, as on the web. */
const DISMISS_ALL_FROM = 2;

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
    <View style={{ gap: space[1] }}>
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

/**
 * « Aujourd'hui » or « Précédemment »: its tiers, then its entries already suivies, folded. `line`, under its heading on
 * a phone (« 2 arrivées aujourd'hui · 3 à traiter », #899). `pinned`, on a phone: each tier's row (TierRow) names the day
 * too and stays at the top of the thread while its entries are in view.
 */
function Day({
  name,
  line,
  day,
  today,
  nothing,
  followed,
  decisions,
  pinned = false,
  showDay = false,
  dismissAll = false,
}: {
  name: string;
  line?: string;
  day: OfferBoxDay;
  today: string;
  nothing: string;
  followed: (count: number) => string;
  decisions: OfferBoxDecisions;
  pinned?: boolean;
  showDay?: boolean;
  dismissAll?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [origin, onLayout] = useLaidOutAt(useContext(PinOrigin));
  return (
    <PinOrigin.Provider value={origin}>
      <View onLayout={onLayout} style={{ gap: space[3] }}>
        <View>
          <AppText variant="h3" heading>
            {name}
          </AppText>
          {line ? (
            <AppText variant="meta" tone="secondary">
              {line}
            </AppText>
          ) : null}
        </View>
        {day.tiers.length === 0 ? <AppText tone="secondary">{nothing}</AppText> : null}
        {day.tiers.map(({ tier, entries }) => {
          const tierName = t(`offerBox.tiers.${tier}`);
          const all = dismissAll && entries.length >= DISMISS_ALL_FROM ? <DismissAll entries={entries} tierName={tierName} decisions={decisions} /> : null;
          return (
            <Tier key={tier} pinned={pinned} day={name} name={tierName} dismissAll={all}>
              {entries.map((entry) => (
                <Line key={entry.id} entry={entry} today={today} showDay={showDay} decisions={decisions} />
              ))}
            </Tier>
          );
        })}
        {day.followed.length > 0 ? (
          <View style={{ gap: space[2] }}>
            <Control label={followed(day.followed.length)} expanded={open} onPress={() => setOpen(!open)} />
            {open ? day.followed.map((entry) => <Line key={entry.id} entry={entry} today={today} showDay={showDay} decisions={decisions} />) : null}
          </View>
        ) : null}
      </View>
    </PinOrigin.Provider>
  );
}

/**
 * An Importance tier and its entries. With columns, its heading then « Tout écarter (n) ». `pinned` (a phone, #899):
 * one row, « Précédemment · À regarder » cut short when need be and « Tout écarter (n) » whole at its right, which stays
 * at the top of the thread while the tier's entries scroll under it (pinRange), as the web's sticky tier does; the day
 * hidden from screen readers, its own heading says it.
 */
function Tier({ pinned, day, name, dismissAll, children }: { pinned: boolean; day: string; name: string; dismissAll: ReactNode; children: ReactNode }) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const thread = useThreadScroll();
  const [top, onLayout] = useLaidOutAt(useContext(PinOrigin));
  const [tierHeight, setTierHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const range = top === null ? null : pinRange(top, tierHeight, rowHeight);
  const translateY = useMemo(
    () => (thread && range ? thread.y.interpolate({ inputRange: range, outputRange: [0, range[1] - range[0]], extrapolate: "clamp" }) : 0),
    [thread, range?.[0], range?.[1]], // eslint-disable-line react-hooks/exhaustive-deps -- the range by its values
  );
  if (!pinned) {
    return (
      <View style={{ gap: space[2] }}>
        <AppText variant="meta" weight="semiBold" tone="secondary" heading>
          {name}
        </AppText>
        {dismissAll ? <View style={{ alignSelf: "flex-start" }}>{dismissAll}</View> : null}
        {children}
      </View>
    );
  }
  // At a large text size the day and the tier wrap whole, and « Tout écarter » goes under them when it must.
  const whole = fontScale >= WHOLE_FROM_FONT_SCALE;
  return (
    <View
      onLayout={(event) => {
        onLayout(event);
        setTierHeight(event.nativeEvent.layout.height);
      }}
      style={{ gap: space[2] }}
    >
      {/* A bar while pinned: its words grow up to twice their size, as the Top Bar's. */}
      <CappedTextScale scale={BAR_MAX_SCALE}>
        <Animated.View
          testID="offer-box-tier-row"
          onLayout={(event) => setRowHeight(event.nativeEvent.layout.height)}
          style={{
            zIndex: 1,
            transform: [{ translateY }],
            flexDirection: "row",
            flexWrap: whole ? "wrap" : "nowrap",
            alignItems: "center",
            gap: space[2],
            minHeight: TARGET,
            backgroundColor: colors.background,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: whole ? "wrap" : "nowrap", alignItems: "baseline" }}>
            <View aria-hidden style={{ flexShrink: 1 }}>
              <AppText variant="meta" tone="secondary" lines={1}>
                {`${day} · `}
              </AppText>
            </View>
            <View style={{ flexShrink: 1 }}>
              <AppText variant="meta" weight="semiBold" tone="secondary" heading lines={1}>
                {name}
              </AppText>
            </View>
          </View>
          {dismissAll ? <View style={{ flexShrink: 0, maxWidth: "100%", alignItems: "flex-end" }}>{dismissAll}</View> : null}
        </Animated.View>
      </CappedTextScale>
      {children}
    </View>
  );
}

/**
 * The thread's scroll offsets over which a tier's row, `rowHeight` high at the top of the tier (`top` in the thread's
 * content, `height` high), stays pinned: from the tier's top reaching the thread's top, to its last entry going under
 * the row. Null when it has nothing to pin over (not laid out yet, or nothing under the row).
 */
export function pinRange(top: number, height: number, rowHeight: number): [number, number] | null {
  const travel = height - rowHeight;
  return rowHeight > 0 && travel > 0 ? [top, top + travel] : null;
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
      {/* The row's lines grow as the row does, up to twice their size (ROW_MAX_SCALE, #705). */}
      <CappedTextScale scale={ROW_MAX_SCALE}>
        <AppText weight="semiBold" tone={tier === "not_to_miss" ? "success" : tier === "to_look_at" ? "warn" : "secondary"}>
          {score}
        </AppText>
        {facts ? <AppText tone="secondary">{facts}</AppText> : null}
        <AppText variant="meta" tone="secondary">
          {tags.join(" · ")}
        </AppText>
      </CappedTextScale>
      {/* « Suivre » is not offered on one « Expirée sans décision » (#817): it still opens, and « Écarter » stays. */}
      <OfferDecision entry={entry} decisions={decisions} canFollow={entry.scoredWith !== null && entry.state !== "expired"} offerLater />
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
