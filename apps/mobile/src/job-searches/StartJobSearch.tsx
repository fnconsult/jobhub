import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useApi } from "../api/api";
import { useProfiles } from "../api/reads";
import { paths } from "../navigation/pages";
import { useAskForPush } from "../push/PushNotifications";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/** How many active Profiles get their own « Lancer une recherche », in the Profiles' order, as on the web. */
const SUGGESTED_PROFILES = 3;

/** Why a Job Search was not started: the Plan Quota spent, the Profile archived meanwhile, or anything else (offline). */
type StartProblem = "quotaExceeded" | "archived" | "generic";

/**
 * Starts a Job Search for `profileId` with the web app's own route (`POST /api/job-searches`, the web's « Lancer une
 * recherche »), opens its page, then asks for Push notifications in context (#699, ADR-0076): « Être prévenu des
 * nouveaux résultats ? ». The page asks only once the Job Search is started: a refusal asks nothing.
 */
export function useStartJobSearch(): (profileId: string) => Promise<StartProblem | null> {
  const api = useApi();
  const router = useRouter();
  const askForPush = useAskForPush();
  return async (profileId) => {
    let response: Response;
    try {
      response = await api("/api/job-searches", { method: "POST", body: JSON.stringify({ profileId }) });
    } catch {
      return "generic";
    }
    const result = (await response.json().catch(() => ({}))) as { id?: unknown; error?: unknown };
    if (response.status === 201 && typeof result.id === "string") {
      router.push(paths.jobSearch(result.id));
      askForPush("jobSearch");
      return null;
    }
    if (response.status === 402) return "quotaExceeded";
    return result.error === "archived" ? "archived" : "generic";
  };
}

/**
 * Recherches d'offres' « Lancer une recherche » (#699), as the web's suggestions above the box: one per active Profile,
 * named after it when the Candidate has several; none without an active Profile. No purchase in the app: a Plan Quota
 * spent is only said (ADR-0076).
 */
export function StartJobSearch() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const start = useStartJobSearch();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<StartProblem | null>(null);
  const active = profiles.data ?? [];
  if (active.length === 0) return null;
  const several = active.length > 1;

  const launch = async (profileId: string) => {
    setWorking(true);
    setProblem(null);
    const refused = await start(profileId);
    setWorking(false);
    setProblem(refused);
  };

  return (
    <View style={{ alignSelf: "stretch", gap: space[2] }}>
      {active.slice(0, SUGGESTED_PROFILES).map((profile) => (
        <Control
          key={profile.id}
          look="secondary"
          icon={Search}
          label={several ? t("jobSearchesMenu.startFor", { profile: profile.name }) : t("jobSearchesMenu.start")}
          disabled={working}
          onPress={() => void launch(profile.id)}
        />
      ))}
      {working ? <AppText tone="secondary">{t("jobSearch.starting")}</AppText> : null}
      {problem ? (
        <View role="alert">
          <AppText>{problem === "quotaExceeded" ? t("mobile.jobSearches.quotaExceeded") : t(`jobSearch.errors.${problem}`)}</AppText>
        </View>
      ) : null}
    </View>
  );
}
