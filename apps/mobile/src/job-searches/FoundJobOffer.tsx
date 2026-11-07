import { matchScoreFigure, matchScoreInWords, matchScoreReasons, matchScoreReliabilityHint, matchScoreWhyInWords, type CriterionStatus } from "@jobhub/shared";
import { matchScoreOfDetail, type FoundJobOffer, type OfferBoxEntryState } from "@jobhub/shared/reads";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useOfferBox } from "../api/reads";
import { openPostingAction, shareLinkAction } from "../navigation/links";
import { paths } from "../navigation/pages";
import { OfferDecision, useDismissalNotice, useFollowJobOffer, useOfferBoxDecisions } from "../offer-box/decisions";
import { useWorkPane } from "../shell/Shell";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { ObjectRow } from "../ui/ObjectRow";

type Named = { id: string; name: string };

/** A verdict is said in words; the colour only reinforces a clear match or mismatch, as on the web (MatchScoreWhy). */
const VERDICT_TONE: Partial<Record<CriterionStatus, "success" | "danger">> = { match: "success", mismatch: "danger" };

/**
 * The Job Offers a Job Search found or a Job Digest brought (#692), best Match Score first as the read gives them: each
 * a row with its Match Score, « Suivie » once followed or « Écartée » once écartée from the Offer box, opened in the Work Pane (FoundJobOfferPane); its context menu
 * opens its posting or shares its web address (`share`).
 */
export function FoundJobOffers({ jobOffers, profile, share }: { jobOffers: readonly FoundJobOffer[]; profile: Named; share: (jobOfferId: string) => string }) {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  return (
    <View style={{ gap: space[2] }}>
      {jobOffers.map((found) => {
        const { jobOffer } = found;
        const open = () => workPane.open({ title: jobOffer.title, content: <FoundJobOfferPane found={found} profile={profile} /> });
        return (
          <View key={jobOffer.id} aria-label={jobOffer.title} style={{ gap: space[1] }}>
            <ObjectRow
              label={[jobOffer.title, jobOffer.employer].filter(Boolean).join(" · ")}
              onPress={open}
              actions={[
                { label: t("mobile.rowMenu.open"), onPress: open },
                ...(jobOffer.url ? [openPostingAction(t("mobile.rowMenu.openPosting"), jobOffer.url)] : []),
                shareLinkAction(t("mobile.rowMenu.shareLink"), share(jobOffer.id)),
              ]}
            />
            <View style={{ paddingHorizontal: space[3] }}>
              <AppText variant="meta" tone="secondary">
                {[found.matchScore === null ? t("offerBox.noScore") : t("offerBox.score", { score: found.matchScore }), jobOffer.location, found.applicationId ? t("offerBox.followed") : found.decision === "dismissed" ? t("offerBox.dismissed") : null]
                .filter(Boolean)
                  .join(" · ")}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * One Job Offer a Job Search found or a Job Digest brought, in the Work Pane (#692), as the web's JobOfferInPane: its
 * facts, its Match Score against `profile` with « Pourquoi 86 ? », « Suivre » (which creates its Application with that
 * Profile, ADR-0090) or, once followed, « Voir la candidature », and « Écarter » as on its Offer box entry (#816); then
 * its Job Offer Summary and its full text. The Offer box's Work Pane opens its entries with it too.
 */
export function FoundJobOfferPane({ found, profile }: { found: FoundJobOffer; profile: Named }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [why, setWhy] = useState(false);
  const { jobOffer } = found;
  const matchScore = matchScoreOfDetail(found.matchScore, found.matchScoreDetail);
  const figure = matchScoreFigure(matchScore);
  const hint = matchScoreReliabilityHint(figure, t);
  const facts = [jobOffer.employer, jobOffer.location, jobOffer.contractType ? t(`cvReview.contractTypes.${jobOffer.contractType}`) : null].filter(Boolean).join(" · ");

  return (
    <View style={{ gap: space[4] }}>
      {facts ? <AppText tone="secondary">{facts}</AppText> : null}
      {jobOffer.expiredAt ? (
        <AppText tone="warn">{t("jobOffer.expired", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(jobOffer.expiredAt)) })}</AppText>
      ) : null}
      <View style={{ gap: space[2], padding: space[3], borderRadius: radius.card, borderWidth: 1, borderColor: colors.border }}>
        <AppText>{t("jobOffer.matchScore", { profile: profile.name })}</AppText>
        <AppText variant="h3" weight="semiBold">
          {matchScoreInWords(figure, t)}
        </AppText>
        {hint ? <AppText tone="secondary">{hint}</AppText> : null}
        <View style={{ alignSelf: "flex-start" }}>
          <Control label={matchScoreWhyInWords(figure, t)} expanded={why} onPress={() => setWhy(!why)} />
        </View>
        {why
          ? matchScoreReasons(matchScore, t, i18n.language).map((reason) => (
              <View key={reason.text} style={{ gap: space[1] }}>
                <AppText weight="semiBold" tone={VERDICT_TONE[reason.status] ?? "secondary"}>
                  {reason.verdict}
                </AppText>
                <AppText>{reason.text}</AppText>
              </View>
            ))
          : null}
      </View>
      <Decision found={found} profile={profile} />
      {jobOffer.summary ? (
        <View style={{ gap: space[1] }}>
          <AppText variant="h3" heading>
            {t("jobOffer.summaryLabel")}
          </AppText>
          <AppText>{jobOffer.summary}</AppText>
        </View>
      ) : null}
      <View style={{ gap: space[1] }}>
        <AppText variant="h3" heading>
          {t("jobOffer.contentTitle")}
        </AppText>
        <AppText>{jobOffer.content}</AppText>
      </View>
    </View>
  );
}

/**
 * Where the Candidate stands with the Job Offer and what they decide, as on its Offer box entry, which the Offer box read
 * finds by its Job Offer (OfferDecision, ADR-0090): « Suivre » with `profile` or, once followed, « Voir la candidature »;
 * « Écarter » with its Dismissal reasons and the notice with « Annuler » (#816); once écartée, its reason and « Revenir
 * sur ce choix ». With no entry found (not read yet, offline), « Suivre » alone.
 */
function Decision({ found, profile }: { found: FoundJobOffer; profile: Named }) {
  const { t } = useTranslation();
  const router = useRouter();
  const workPane = useWorkPane();
  const box = useOfferBox();
  const followJobOffer = useFollowJobOffer();
  const { decisions, notice } = useDismissalNotice(useOfferBoxDecisions());
  const [followedAs, setFollowedAs] = useState(found.applicationId);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const { jobOffer } = found;
  const entry = box.data?.entries.find((one) => one.jobOffer.id === jobOffer.id);
  const applicationId = followedAs ?? entry?.applicationId ?? null;
  const follow = async () => {
    const saved = await followJobOffer(jobOffer.id, profile.id);
    if (saved !== null) setFollowedAs(saved);
    return saved !== null;
  };
  const seeApplication = () => {
    if (!applicationId) return;
    workPane.close();
    router.navigate(paths.application(applicationId));
  };
  const followed = (
    <View style={{ gap: space[2], alignItems: "flex-start" }}>
      <AppText tone="success">{t("offerBox.followed")}</AppText>
      <Control label={t("offerBox.seeApplication")} look="secondary" onPress={seeApplication} />
    </View>
  );
  const followNote = (
    <AppText variant="meta" tone="secondary">
      {t("mobile.jobOffer.followCreates", { profile: profile.name })}
    </AppText>
  );
  if (entry) {
    // Followed here, or still followed: the entry last read may not know it yet. Otherwise, as the entry stands.
    const standing: OfferBoxEntryState = applicationId !== null ? "followed" : entry.state === "followed" ? "to_handle" : entry.state;
    return (
      <View style={{ gap: space[2] }}>
        <OfferDecision
          entry={entry}
          state={standing}
          decisions={{ ...decisions, follow }}
          canFollow
          followed={followed}
          followNote={followNote}
        />
        {notice}
      </View>
    );
  }
  if (applicationId !== null) return followed;
  const onFollow = async () => {
    setWorking(true);
    setFailed(false);
    const done = await follow();
    setWorking(false);
    setFailed(!done);
  };
  return (
    <View style={{ gap: space[1], alignItems: "flex-start" }}>
      <Control
        label={working ? t("offerBox.following") : t("offerBox.follow")}
        accessibleName={`${t("offerBox.follow")} : ${jobOffer.title}`}
        look="primary"
        disabled={working}
        onPress={() => void onFollow()}
      />
      {followNote}
      {failed ? <AppText tone="danger">{t("offerBox.followError")}</AppText> : null}
    </View>
  );
}
