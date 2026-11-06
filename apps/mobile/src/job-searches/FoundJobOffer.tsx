import { matchScoreFigure, matchScoreInWords, matchScoreReasons, matchScoreReliabilityHint, matchScoreWhyInWords, type CriterionStatus } from "@jobhub/shared";
import { matchScoreOfDetail, type FoundJobOffer } from "@jobhub/shared/reads";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useApi } from "../api/api";
import { openPostingAction, shareLinkAction } from "../navigation/links";
import { paths } from "../navigation/pages";
import { readKey } from "../offline/read-cache";
import { useWorkPane } from "../shell/Shell";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { ObjectRow } from "../ui/ObjectRow";

type Named = { id: string; name: string };

/** A verdict is said in words; the colour only reinforces a clear match or mismatch, as on the web (MatchScoreWhy). */
const VERDICT_TONE: Partial<Record<CriterionStatus, "success" | "danger">> = { match: "success", mismatch: "danger" };

/**
 * « Suivre » (ADR-0090): saves the Job Offer as an Application with `profile`, as the Offer box's « Suivre » does
 * (`POST /api/applications`), then has every read that shows it read again (the Job Search, the Job Digest, the Offer
 * box, Mes candidatures). The Application's id, or null when it was not saved.
 */
export function useFollowJobOffer(): (jobOfferId: string, profileId: string) => Promise<string | null> {
  const api = useApi();
  const queries = useQueryClient();
  return async (jobOfferId, profileId) => {
    const response = await api("/api/applications", { method: "POST", body: JSON.stringify({ jobOfferId, profileId }) }).catch(() => null);
    if (!response || (response.status !== 200 && response.status !== 201)) return null;
    const saved = (await response.json().catch(() => ({}))) as { id?: unknown };
    await Promise.all(
      (["jobSearch", "jobDigest", "offerBox", "applications"] as const).map((name) => queries.invalidateQueries({ queryKey: readKey(name) })),
    );
    return typeof saved.id === "string" ? saved.id : null;
  };
}

/**
 * The Job Offers a Job Search found or a Job Digest brought (#692), best Match Score first as the read gives them: each
 * a row with its Match Score, « Suivie » once followed, opened in the Work Pane (FoundJobOfferPane); its context menu
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
                {[found.matchScore === null ? t("offerBox.noScore") : t("offerBox.score", { score: found.matchScore }), jobOffer.location, found.applicationId ? t("offerBox.followed") : null]
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
 * Profile, ADR-0090) or, once followed, « Voir la candidature »; then its Job Offer Summary and its full text.
 */
export function FoundJobOfferPane({ found, profile }: { found: FoundJobOffer; profile: Named }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const workPane = useWorkPane();
  const follow = useFollowJobOffer();
  const [applicationId, setApplicationId] = useState(found.applicationId);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [why, setWhy] = useState(false);
  const { jobOffer } = found;
  const matchScore = matchScoreOfDetail(found.matchScore, found.matchScoreDetail);
  const figure = matchScoreFigure(matchScore);
  const hint = matchScoreReliabilityHint(figure, t);
  const facts = [jobOffer.employer, jobOffer.location, jobOffer.contractType ? t(`cvReview.contractTypes.${jobOffer.contractType}`) : null].filter(Boolean).join(" · ");

  const onFollow = async () => {
    setWorking(true);
    setFailed(false);
    const saved = await follow(jobOffer.id, profile.id);
    setWorking(false);
    if (saved === null) return setFailed(true);
    setApplicationId(saved);
  };
  const seeApplication = () => {
    if (!applicationId) return;
    workPane.close();
    router.navigate(paths.application(applicationId));
  };

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
      {applicationId !== null ? (
        <View style={{ gap: space[2], alignItems: "flex-start" }}>
          <AppText tone="success">{t("offerBox.followed")}</AppText>
          <Control label={t("offerBox.seeApplication")} look="secondary" onPress={seeApplication} />
        </View>
      ) : (
        <View style={{ gap: space[1], alignItems: "flex-start" }}>
          <Control
            label={working ? t("offerBox.following") : t("offerBox.follow")}
            accessibleName={`${t("offerBox.follow")} : ${jobOffer.title}`}
            look="primary"
            disabled={working}
            onPress={() => void onFollow()}
          />
          <AppText variant="meta" tone="secondary">
            {t("mobile.jobOffer.followCreates", { profile: profile.name })}
          </AppText>
          {failed ? <AppText tone="danger">{t("offerBox.followError")}</AppText> : null}
        </View>
      )}
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
