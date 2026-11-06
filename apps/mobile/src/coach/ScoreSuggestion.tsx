import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useApi } from "../api/api";
import { useProfiles } from "../api/reads";
import { useOnline } from "../offline/read-cache";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

type Profile = { id: string; name: string };
type Outcome =
  | { kind: "scored"; score: number; profile: Profile }
  | { kind: "refused"; prompt: { title: string; message: string } }
  | { kind: "failed" };

/** The Upgrade Prompt of a 402 (apps/web/src/billing/upgrade-prompt.ts): what was reached, and which Plan goes further. */
const promptOf = (answer: unknown): { title: string; message: string } | null => {
  const prompt = (answer as { prompt?: { title?: unknown; message?: unknown } } | null)?.prompt;
  return typeof prompt?.title === "string" && typeof prompt.message === "string" ? { title: prompt.title, message: prompt.message } : null;
};

/**
 * « Scorer contre mon profil » above the box of a conversation whose latest Job Offer card is still to process (#697):
 * the Match Score of the Job Offer against the Candidate's Profile (`POST /api/match-score`), which counts against their
 * Plan Quota as on the web; with several Profiles, one button per Profile. Refused by the Plan Quota, it says so as the
 * web's Upgrade Prompt does, without anything to buy: the subscription is managed on jobbbox.ai (ADR-0076). The score is
 * shown, not saved: following the Job Offer as an Application keeps it.
 */
export function ScoreSuggestion({ jobOfferId }: { jobOfferId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const api = useApi();
  const online = useOnline();
  const profiles = useProfiles().data;
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const score = async (profile: Profile) => {
    setBusy(true);
    setOutcome(null);
    try {
      const response = await api("/api/match-score", { method: "POST", body: JSON.stringify({ jobOfferId, profileId: profile.id }) });
      const answer: unknown = await response.json().catch(() => null);
      const prompt = response.status === 402 ? promptOf(answer) : null;
      const figure = (answer as { score?: unknown } | null)?.score;
      if (prompt) setOutcome({ kind: "refused", prompt });
      else if (response.ok && typeof figure === "number") setOutcome({ kind: "scored", score: Math.round(figure), profile });
      else setOutcome({ kind: "failed" });
    } catch {
      setOutcome({ kind: "failed" });
    }
    setBusy(false);
  };
  const choose = () => {
    if (profiles?.length === 1) void score(profiles[0]!);
    else setAsked(true);
  };

  return (
    <View style={{ gap: space[2] }}>
      {asked && profiles && profiles.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {profiles.map((profile) => (
            <Control key={profile.id} look="secondary" label={t("shareCapture.scoreAgainst", { profile: profile.name })} disabled={busy || !online} onPress={() => void score(profile)} />
          ))}
        </View>
      ) : (
        <View style={{ alignSelf: "flex-start" }}>
          <Control look="secondary" label={t("shareCapture.score")} disabled={busy || !online || !profiles} onPress={choose} />
        </View>
      )}
      {asked && profiles?.length === 0 ? <AppText tone="secondary">{t("shareCapture.noProfile")}</AppText> : null}
      {busy ? (
        <View role="status">
          <AppText tone="secondary">{t("shareCapture.scoring")}</AppText>
        </View>
      ) : null}
      {outcome?.kind === "scored" ? (
        <View role="status">
          <AppText weight="semiBold">{t("shareCapture.scored", { score: outcome.score, profile: outcome.profile.name })}</AppText>
        </View>
      ) : null}
      {outcome?.kind === "failed" ? (
        <View role="alert">
          <AppText tone="danger">{t("shareCapture.scoreFailed")}</AppText>
        </View>
      ) : null}
      {outcome?.kind === "refused" ? (
        <View role="alert" style={{ gap: space[1], padding: space[3], borderRadius: radius.card, backgroundColor: colors.warnSoft }}>
          <AppText weight="semiBold">{outcome.prompt.title}</AppText>
          <AppText>{outcome.prompt.message}</AppText>
          <AppText tone="secondary">{t("mobile.subscriptionOnWeb")}</AppText>
        </View>
      ) : null}
    </View>
  );
}
