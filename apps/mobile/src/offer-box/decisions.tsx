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
}

/** The Offer box's decisions on the web app's routes, wherever its entry shows: in the box, or opened in the Work Pane. */
export function useOfferBoxDecisions(): OfferBoxDecisions {
  const write = useDecisionWrite();
  const followJobOffer = useFollowJobOffer();
  const dismissal = (entry: OfferBoxEntryRead) => `/api/offer-box/${encodeURIComponent(entry.id)}/dismissal`;
  return {
    follow: async (entry) => (entry.scoredWith ? (await followJobOffer(entry.jobOffer.id, entry.scoredWith.id)) !== null : false),
    dismiss: async (entry, reason) => (await write(dismissal(entry), { method: "POST", body: JSON.stringify({ reason }) }, [204])) !== null,
    reconsider: async (entry) => (await write(dismissal(entry), { method: "DELETE" }, [204])) !== null,
  };
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

/**
 * The notice an « Écarter » leaves (#816), as the web's toast: « « Titre » écartée. » with « Annuler » for a few seconds,
 * announced on iOS too; an « Annuler » that fails says the offer stays écartée. `decisions` with their « Écarter »
 * showing it once done, and the `notice` to place where it is seen.
 */
export function useDismissalNotice(decisions: OfferBoxDecisions): { decisions: OfferBoxDecisions; notice: ReactNode } {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [shown, setShown] = useState<OfferBoxEntryRead | null>(null);
  const [undoFailed, setUndoFailed] = useState(false);
  useEffect(() => {
    if (!shown) return;
    announce(t("offerBox.dismissedToast", { title: shown.jobOffer.title }));
    const timer = setTimeout(() => setShown(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shown, t]);
  useEffect(() => {
    if (undoFailed) announce(t("offerBox.undoError"));
  }, [undoFailed, t]);
  const noticed: OfferBoxDecisions = {
    follow: decisions.follow,
    dismiss: async (entry, reason) => {
      setUndoFailed(false);
      const done = await decisions.dismiss(entry, reason);
      if (done) setShown(entry);
      return done;
    },
    reconsider: decisions.reconsider,
  };
  const notice = (
    <>
      {shown ? (
        <View aria-live={ANNOUNCED} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], padding: space[2], borderRadius: radius.md, backgroundColor: colors.surface }}>
          <AppText>{t("offerBox.dismissedToast", { title: shown.jobOffer.title })}</AppText>
          <Control
            label={t("offerBox.undo")}
            look="secondary"
            onPress={() => {
              const entry = shown;
              setShown(null);
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
    </>
  );
  return { decisions: noticed, notice };
}

/**
 * Where the Candidate stands with an Offer box entry, and what they can decide (ADR-0090): « Suivie » (or `followed`,
 * what the place shows of it); « Écartée », its reason and « Revenir sur ce choix »; à traiter, « Suivre » when it can be
 * saved with a Profile, then `followNote`, and « Écarter » with its Dismissal reasons opened under it. A decision
 * that fails is said under it.
 */
export function OfferDecision({
  entry,
  state = entry.state,
  decisions,
  canFollow = entry.scoredWith !== null,
  followed,
  followNote,
}: {
  entry: OfferBoxEntryRead;
  /** Whether « Suivre » is offered: when the entry has a Profile to be saved with, unless the place gives one. */
  canFollow?: boolean;
  /** Where it stands, when the place knows better than the entry last read (a Job Offer just followed). */
  state?: OfferBoxEntryState;
  decisions: OfferBoxDecisions;
  followed?: ReactNode;
  followNote?: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<"follow" | "dismiss" | "reconsider" | null>(null);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const { title } = entry.jobOffer;
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
    <>
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
          </View>
          {followNote}
        </>
      )}
      {state === "to_handle" && reasonsOpen ? (
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
    </>
  );
}
