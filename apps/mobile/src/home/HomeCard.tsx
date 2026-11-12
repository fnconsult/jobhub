import { applicationsResponseSchema } from "@jobhub/shared/reads";
import { useRouter } from "expo-router";
import { Briefcase, Calendar, FileUp, MessageSquare, RotateCcw, Search, Users, type LucideIcon } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { agendaFormats, frenchDay } from "../agenda/french-time";
import { useAgenda, useOffersToHandle, useProfiles, useRead } from "../api/reads";
import { useCoachBox } from "../coach/CoachConversation";
import { useFreeConversations } from "../navigation/FreeConversations";
import { INTERVIEWS, paths } from "../navigation/pages";
import { useWorkPane } from "../shell/Shell";
import { radius, space, useTheme } from "../theme/theme";
import { AppText, CappedTextScale, ROW_MAX_SCALE } from "../ui/AppText";
import { ObjectRow } from "../ui/ObjectRow";
import { SessionWebPage } from "../web-pages/WebPageScreen";
import { todayLines, type TodayLine } from "./today";

/** The web's page creating a Profile: its Onboarding Questionnaire for a Candidate with no CV to send (#979). */
const NEW_PROFILE_ON_WEB = "/profils/nouveau";

/**
 * Whether the Candidate has a Profile yet: `null` while it is not known (loading, or not read), so the home page shows
 * neither card rather than the wrong one.
 */
export function useHasProfile(): boolean | null {
  const profiles = useProfiles();
  return profiles.data ? profiles.data.length > 0 : null;
}

/**
 * The home page's card (#979), in its Introduction: « Votre point du jour » for a Candidate with a Profile, its lines
 * only what calls for their action, each opening its page; none when there is nothing to show. « Pour commencer » for
 * one without a Profile: « Envoyer mon CV » opens the box's own CV picker, « Je n'ai pas de CV à jour » the web's
 * Profile creation and its questionnaire.
 */
export function HomeCard({ hasProfile }: { hasProfile: boolean | null }) {
  if (hasProfile === null) return null;
  return hasProfile ? <TodayCard /> : <StartCard />;
}

function TodayCard() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const offers = useOffersToHandle();
  const agenda = useAgenda();
  const applications = useRead("applications", "/api/applications", applicationsResponseSchema, []);
  const conversations = useFreeConversations();
  const formats = useMemo(() => agendaFormats(i18n.language), [i18n.language]);
  const when = (instant: string) => t("mobile.home.when", { day: formats.day(frenchDay(new Date(instant))), time: formats.time(instant) });
  const lines = todayLines(
    { offersToHandle: offers.data?.toHandle, agenda: agenda.data, applications: applications.data, conversations: conversations.data },
    new Date(),
  );
  if (lines.length === 0) return null;

  const row = (line: TodayLine): { icon: LucideIcon; label: string; detail?: string; open: () => void } => {
    switch (line.kind) {
      case "offersToHandle":
        return { icon: Search, label: t("conversationFirst.offersToHandle", { count: line.count }), open: () => router.navigate(paths.jobSearches) };
      case "interview":
        return {
          icon: Calendar,
          label: t("mobile.home.interview", { when: when(line.scheduledAt) }),
          detail: [line.jobTitle, line.employer].filter(Boolean).join(" · "),
          open: () => router.navigate(paths.applicationSection(line.applicationId, INTERVIEWS)),
        };
      case "coachingSession":
        return { icon: Users, label: t("mobile.home.coachingSession", { when: when(line.scheduledAt) }), detail: line.coachName, open: () => router.navigate(paths.coachingSession(line.id)) };
      case "toSchedule":
        return { icon: Calendar, label: t("mobile.home.toSchedule", { count: line.count }), open: () => router.navigate(paths.agenda) };
      case "followUps":
        return {
          icon: Briefcase,
          label: t("mobile.home.followUps", { count: line.count }),
          detail: line.titles.join(", ") + (line.count > line.titles.length ? "…" : ""),
          open: () => router.navigate(line.applicationId ? paths.application(line.applicationId) : paths.applications),
        };
      case "resume":
        return { icon: RotateCcw, label: t("mobile.home.resume", { title: line.title }), open: () => router.navigate(paths.conversation(line.conversationId)) };
    }
  };

  return (
    <HomeCardFrame title={t("mobile.home.today")}>
      {lines.map((line) => {
        const shown = row(line);
        return <Line key={line.kind} {...shown} />;
      })}
    </HomeCardFrame>
  );
}

function StartCard() {
  const { t } = useTranslation();
  const box = useCoachBox();
  const workPane = useWorkPane();
  return (
    <HomeCardFrame title={t("mobile.home.start.title")}>
      <Line icon={FileUp} label={t("mobile.home.start.sendCv")} detail={t("mobile.home.start.sendCvDetail")} open={box.pickCv} />
      <Line
        icon={MessageSquare}
        label={t("mobile.home.start.noCv")}
        detail={t("mobile.home.start.noCvDetail")}
        open={() => workPane.open({ title: t("mobile.attachments.newProfile"), fill: true, content: <SessionWebPage path={NEW_PROFILE_ON_WEB} /> })}
      />
    </HomeCardFrame>
  );
}

/** One line: the row that opens its page, and what it is about under it. */
function Line({ icon, label, detail, open }: { icon: LucideIcon; label: string; detail?: string; open: () => void }) {
  return (
    <View>
      <ObjectRow label={label} icon={icon} onPress={open} actions={[]} />
      {detail ? (
        <CappedTextScale scale={ROW_MAX_SCALE}>
          <AppText variant="meta" tone="secondary">
            {detail}
          </AppText>
        </CappedTextScale>
      ) : null}
    </View>
  );
}

function HomeCardFrame({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[2], padding: space[4], borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <AppText variant="h3" heading>
        {title}
      </AppText>
      {children}
    </View>
  );
}
