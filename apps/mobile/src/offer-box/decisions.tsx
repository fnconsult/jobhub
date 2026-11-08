import { DISMISSAL_REASONS, type DismissalReason, type OfferBoxEntryRead, type OfferBoxEntryState } from "@jobhub/shared/reads";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Platform, View } from "react-native";
import { useApi } from "../api/api";
import { readKey, type ReadName } from "../offline/read-cache";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/**
 * The reads that show where the Candidate stands with a Job Offer (ADR-0090): the Offer box and an entry opened, its
 * count of offers à traiter (#818), a Job Search's and a Job Digest's Job Offers, Mes candidatures. Each decision has them
 * read again.
 */
const SHOWING_DECISIONS: readonly ReadName[] = ["offerBox", "offerBoxOffer", "offersToHandle", "jobSearch", "jobDigest", "applications"];

/** A decision's write, then every read that shows it read again: whether the web app answered one of `ok`. */
function useDecisionWrite() {
  const api = useApi();
  const queries = useQueryClient();
  return async (path: string, init: RequestInit, ok: number[]): Promise<Response | null> => {
    const response = await api(path, init).catch(() => null);
    if (!response || !ok.includes(response.status)) return null;
    await Promise.all(SHOWING_DECISIONS.map((name) => queries.invalidateQueries({ queryKey: readKey(name) })));
    return response;
  };
}

/**
 * « Suivre » (ADR-0090): saves the Job Offer as an Application with `profileId` (`POST /api/applications`), the Offer
 * box's and a Job Search's or a Job Digest's alike, then has every read that shows it read again. The Application's id,
 * or null when it was not saved.
 */
export function useFollowJobOffer(): (jobOfferId: string, profileId: string) => Promise<string | null> {
  const write = useDecisionWrite();
  return async (jobOfferId, profileId) => {
    const response = await write("/api/applications", { method: "POST", body: JSON.stringify({ jobOfferId, profileId }) }, [200, 201]);
    if (!response) return null;
    const saved = (await response.json().catch(() => ({}))) as { id?: unknown };
    return typeof saved.id === "string" ? saved.id : null;
  };
}

/** What the Candidate decides on an Offer box entry, each answering whether it was done (the reads then read again). */
export interface OfferBoxDecisions {
  /** « Suivre », with the Profile the entry is scored against. */
  follow(entry: OfferBoxEntryRead): Promise<boolean>;
  /** « Écarter », with a Dismissal reason or none (`POST /api/offer-box/:id/dismissal`, #816). */
  dismiss(entry: OfferBoxEntryRead, reason: DismissalReason | null): Promise<boolean>;
  /** « Revenir sur ce choix », and the notice's « Annuler » (its `DELETE`). */
  reconsider(entry: OfferBoxEntryRead): Promise<boolean>;
  /** « Plus tard » (#817, `POST /api/offer-box/:id/later`): the Monday 00:00 Paris time it comes back, or null when it was not done. */
  later(entry: OfferBoxEntryRead): Promise<string | null>;
  /** The « Plus tard » notice's « Annuler » (its `DELETE`). */
  cancelLater(entry: OfferBoxEntryRead): Promise<boolean>;
  /** « Tout écarter (n) » (#817, `POST /api/offer-box/dismissals`): the ids it écarta, or null when it was not done. */
  dismissAll(entries: OfferBoxEntryRead[]): Promise<string[] | null>;
  /** The « Tout écarter » notice's « Annuler » (its `DELETE`): the ids it écarta, à traiter again. */
  reconsiderAll(entryIds: string[]): Promise<boolean>;
}

/** A write's JSON answer, when it is an object. */
const answerOf = async (response: Response | null): Promise<Record<string, unknown> | null> => {
  const json: unknown = response ? await response.json().catch(() => null) : null;
  return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
};

/** The Offer box's decisions on the web app's routes, wherever its entry shows: in the box, or opened in the Work Pane. */
export function useOfferBoxDecisions(): OfferBoxDecisions {
  const write = useDecisionWrite();
  const followJobOffer = useFollowJobOffer();
  const dismissal = (entry: OfferBoxEntryRead) => `/api/offer-box/${encodeURIComponent(entry.id)}/dismissal`;
  const later = (entry: OfferBoxEntryRead) => `/api/offer-box/${encodeURIComponent(entry.id)}/later`;
  return {
    follow: async (entry) => (entry.scoredWith ? (await followJobOffer(entry.jobOffer.id, entry.scoredWith.id)) !== null : false),
    dismiss: async (entry, reason) => (await write(dismissal(entry), { method: "POST", body: JSON.stringify({ reason }) }, [204])) !== null,
    reconsider: async (entry) => (await write(dismissal(entry), { method: "DELETE" }, [204])) !== null,
    later: async (entry) => {
      const answer = await answerOf(await write(later(entry), { method: "POST" }, [200]));
      return typeof answer?.laterUntil === "string" ? answer.laterUntil : null;
    },
    cancelLater: async (entry) => (await write(later(entry), { method: "DELETE" }, [204])) !== null,
    dismissAll: async (entries) => {
      const answer = await answerOf(await write("/api/offer-box/dismissals", { method: "POST", body: JSON.stringify({ entryIds: entries.map((entry) => entry.id) }) }, [200]));
      return Array.isArray(answer?.dismissed) ? answer.dismissed.filter((id): id is string => typeof id === "string") : null;
    },
    reconsiderAll: async (entryIds) => (await write("/api/offer-box/dismissals", { method: "DELETE", body: JSON.stringify({ entryIds }) }, [204])) !== null,
  };
}

/** A day as the Offer box writes it, in French time: « 9 nov. ». */
export const parisDate = (instant: string, language: string) =>
  new Intl.DateTimeFormat(language, { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(instant));

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

/** What the notice says of what was just done, and its « Annuler »: what it undoes, and what it says when that fails. */
interface Notice {
  message: string;
  undo: () => Promise<boolean>;
  undoError: string;
}

/**
 * The notice a decision leaves, as the web's toast: « « Titre » écartée. » after « Écarter » (#816), « « Titre » revient
 * lundi … » after « Plus tard », « n offres écartées. » after « Tout écarter (n) » (#817), each with « Annuler » for a few
 * seconds, announced on iOS too; an « Annuler » that fails says so. `decisions` with those three showing it once done,
 * and the `notice` to place where it is seen.
 */
export function useDismissalNotice(decisions: OfferBoxDecisions): { decisions: OfferBoxDecisions; notice: ReactNode } {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [shown, setShown] = useState<Notice | null>(null);
  const [undoFailed, setUndoFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!shown) return;
    announce(shown.message);
    const timer = setTimeout(() => setShown(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  useEffect(() => {
    if (undoFailed) announce(undoFailed);
  }, [undoFailed]);
  /** A decision whose notice offers « Annuler »: the notice shown once it is done. */
  const noticed = async <T,>(run: () => Promise<T | null>, notice: (done: T) => Notice): Promise<T | null> => {
    setUndoFailed(null);
    const done = await run();
    if (done !== null) setShown(notice(done));
    return done;
  };
  const withNotice: OfferBoxDecisions = {
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
  const notice = (
    <>
      {shown ? (
        <View aria-live={ANNOUNCED} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], padding: space[2], borderRadius: radius.md, backgroundColor: colors.surface }}>
          <AppText>{shown.message}</AppText>
          <Control
            label={t("offerBox.undo")}
            look="secondary"
            onPress={() => {
              const { undo, undoError } = shown;
              setShown(null);
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
    </>
  );
  return { decisions: withNotice, notice };
}

/** What a decision that failed says under its entry. */
const FAILURES = { follow: "offerBox.followError", dismiss: "offerBox.dismissError", reconsider: "offerBox.reconsiderError", later: "offerBox.laterError" } as const;

/**
 * Where the Candidate stands with an Offer box entry, and what they can decide (ADR-0090): « Suivie » (or `followed`,
 * what the place shows of it); « Écartée », its reason and « Revenir sur ce choix »; undecided, « Suivre » when it can be
 * saved with a Profile, then `followNote`, « Écarter » with its Dismissal
 * reasons opened under it, and with `offerLater` « Plus tard » on one à traiter; one « Plus tard » says « revient lundi n ».
 * A decision that fails is said under it.
 */
export function OfferDecision({
  entry,
  state = entry.state,
  decisions,
  canFollow = entry.scoredWith !== null,
  offerLater = false,
  followed,
  followNote,
}: {
  entry: OfferBoxEntryRead;
  /** Whether « Suivre » is offered: when the entry has a Profile to be saved with, unless the place gives one. */
  canFollow?: boolean;
  /** Whether « Plus tard » is offered on an entry à traiter: in the Offer box (#817). */
  offerLater?: boolean;
  /** Where it stands, when the place knows better than the entry last read (a Job Offer just followed). */
  state?: OfferBoxEntryState;
  decisions: OfferBoxDecisions;
  followed?: ReactNode;
  followNote?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<keyof typeof FAILURES | null>(null);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const { title } = entry.jobOffer;
  /** One decision on the entry: its failure said under it. */
  const decide = async (kind: keyof typeof FAILURES, run: () => Promise<boolean>) => {
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
  const undecided = state === "to_handle" || state === "later" || state === "expired";
  return (
    <>
      {state === "later" && entry.laterUntil ? <AppText tone="accent">{t("offerBox.laterUntil", { date: parisDate(entry.laterUntil, i18n.language) })}</AppText> : null}
      {state === "followed" ? (
        (followed ?? <AppText tone="success">{t("offerBox.followed")}</AppText>)
      ) : state === "dismissed" ? (
        <>
          <AppText tone="secondary">
            {entry.dismissalReason ? t("offerBox.dismissedWithReason", { reason: t(`offerBox.dismissalReasons.${entry.dismissalReason}`) }) : t("offerBox.dismissed")}
          </AppText>
          <View style={{ alignSelf: "flex-start" }}>
            <Control label={t("offerBox.reconsider")} accessibleName={t("offerBox.reconsiderLabel", { title })} look="secondary" disabled={working} onPress={reconsider} />
          </View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {canFollow ? (
              <Control
                label={working ? t("offerBox.following") : t("offerBox.follow")}
                accessibleName={`${t("offerBox.follow")} : ${title}`}
                look="primary"
                disabled={working}
                onPress={follow}
              />
            ) : null}
            <Control
              label={t("offerBox.dismiss")}
              accessibleName={t("offerBox.dismissLabel", { title })}
              look="secondary"
              expanded={reasonsOpen}
              disabled={working}
              onPress={() => setReasonsOpen(!reasonsOpen)}
            />
            {offerLater && state === "to_handle" ? (
              <Control label={t("offerBox.later")} accessibleName={t("offerBox.laterLabel", { title })} look="secondary" disabled={working} onPress={later} />
            ) : null}
          </View>
          {followNote}
        </>
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
    </>
  );
}
