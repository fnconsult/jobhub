import { coachingTime } from "@jobhub/shared/coaching-time";
import { useRouter } from "expo-router";
import { CalendarPlus } from "lucide-react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { SessionJoin } from "../coaching/SessionJoin";
import { useCoachSpaceV2 } from "../navigation/human-coach";
import { INTERVIEWS, paths } from "../navigation/pages";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText, CappedTextScale, ROW_MAX_SCALE } from "../ui/AppText";
import { Control } from "../ui/Control";
import { addToCalendar, type CalendarSheets } from "./add-to-calendar";
import type {
  Agenda,
  AgendaItem,
  CoachingSessionAgendaItem,
  InterviewAgendaItem,
  UnscheduledCoachingSession,
} from "./agenda-read";
import { canAddToCalendar } from "./calendar-event";
import { agendaFormats } from "./french-time";

type Formats = ReturnType<typeof agendaFormats>;

/**
 * The Agenda as a list (ADR-0076: no week or month in the app's v1): « À planifier » first, the Unscheduled Coaching
 * Sessions with their Human Coach's booking link, then the Agenda Items by day, in French time. An Interview leads to
 * its Application's Interviews Section, a Coaching Session to its Human Coach; each upcoming one not cancelled has
 * « Ajouter à mon calendrier », through the system's sheets (`sheets`, ADR-0029). In a conversation's card (#690), it
 * `scrolls` with the conversation rather than on its own.
 */
export function AgendaList({
  agenda,
  sheets,
  now = new Date(),
  scrolls = true,
}: {
  agenda: Agenda;
  sheets: CalendarSheets;
  now?: Date;
  scrolls?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const formats = useMemo(() => agendaFormats(i18n.language), [i18n.language]);
  const coachSpaceV2 = useCoachSpaceV2();
  const add = (item: AgendaItem) => {
    // A sheet that cannot open leaves the Agenda as it is: nothing was added. « Espace coach v2 » off: in French time.
    addToCalendar(coachSpaceV2 ? item : withoutCoachSpaceV2(item), { sheets, t, now }).catch(() => {});
  };
  const empty = agenda.toSchedule.length === 0 && agenda.days.length === 0;
  const Container = scrolls ? ListScroll : ListInCard;
  return (
    <Container>
      {agenda.toSchedule.length > 0 ? (
        <ToSchedule sessions={agenda.toSchedule} formats={formats} />
      ) : null}
      {agenda.days.map((day) => (
        <View key={day.day} style={{ gap: space[3] }}>
          <AppText variant="h3" heading>
            {formats.day(day.day)}
          </AppText>
          {day.items.map((item) =>
            item.kind === "interview" ? (
              <InterviewRow
                key={`${item.kind}-${item.id}`}
                item={item}
                formats={formats}
                onAdd={add}
              />
            ) : (
              <CoachingSessionRow
                key={`${item.kind}-${item.id}`}
                item={item}
                formats={formats}
                onAdd={add}
              />
            ),
          )}
        </View>
      ))}
      {empty ? <AppText tone="secondary">{t("agenda.none")}</AppText> : null}
    </Container>
  );
}

/** An Agenda Item as before the Human Coach epic (« Espace coach v2 » off): no time zone, no meeting. */
function withoutCoachSpaceV2(item: AgendaItem): AgendaItem {
  if (item.kind !== "coachingSession") return item;
  const before = { ...item };
  delete before.timeZone;
  delete before.meeting;
  return before;
}

const ListScroll = ({ children }: { children: React.ReactNode }) => (
  <ScrollView contentContainerStyle={{ padding: space[4], gap: space[6] }}>
    {children}
  </ScrollView>
);

const ListInCard = ({ children }: { children: React.ReactNode }) => (
  <View style={{ gap: space[6] }}>{children}</View>
);

/** « À planifier »: each paid Coaching Session with no date yet, and its Human Coach's Cal.com page to book a time. */
function ToSchedule({
  sessions,
  formats,
}: {
  sessions: UnscheduledCoachingSession[];
  formats: Formats;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space[3] }}>
      <AppText variant="h3" heading>
        {t("agenda.toSchedule")}
      </AppText>
      <AppText tone="secondary">{t("agenda.toScheduleIntro")}</AppText>
      {sessions.map((session) => (
        <Card key={session.id}>
          <AppText weight="semiBold">
            {t("humanCoaches.sessionPaidOn", {
              name: session.coach.name,
              date: formats.date(session.paidAt),
            })}
          </AppText>
          <Control
            label={t("humanCoaches.pickSlot", { name: session.coach.name })}
            look="primary"
            onPress={() => {
              Linking.openURL(session.coach.bookingUrl).catch(() => {});
            }}
          />
        </Card>
      ))}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        gap: space[2],
        padding: space[3],
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
      }}
    >
      {children}
    </View>
  );
}

/**
 * An Agenda Item's link to where it leads, with its time and what it is. Its words grow up to twice their size, as an
 * object's row does (ROW_MAX_SCALE, #705): growing freely, at iOS's largest on an iPhone SE, an Interview's line broke
 * its words mid-word beside its time and stood taller than the conversation's thread.
 */
function ItemLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable
      role="link"
      onPress={() => router.navigate(href)}
      style={({ pressed }) => ({
        minHeight: TARGET,
        flexDirection: "row",
        gap: space[3],
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.hover : "transparent",
      })}
    >
      <CappedTextScale scale={ROW_MAX_SCALE}>{children}</CappedTextScale>
    </Pressable>
  );
}

/** « Ajouter à mon calendrier », its accessible name saying which item and when, since the Agenda lists several. */
function AddToCalendar({
  item,
  what,
  formats,
  onAdd,
}: {
  item: AgendaItem;
  what: string;
  formats: Formats;
  onAdd: (item: AgendaItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const coachSpaceV2 = useCoachSpaceV2();
  if (!canAddToCalendar(item)) return null;
  return (
    <View style={{ alignSelf: "flex-start" }}>
      <Control
        label={t("agenda.calendarFile.add")}
        accessibleName={t("agenda.calendarFile.addFor", {
          what,
          date: coachSpaceV2 && item.kind === "coachingSession" ? coachingTime(new Date(item.scheduledAt), i18n.language, item.timeZone) : formats.dateTime(item.scheduledAt),
        })}
        icon={CalendarPlus}
        onPress={() => onAdd(item)}
      />
    </View>
  );
}

/** An Interview: its time, its Job Offer and company; a Cancelled one struck through, with its date of cancellation. */
function InterviewRow({
  item,
  formats,
  onAdd,
}: {
  item: InterviewAgendaItem;
  formats: Formats;
  onAdd: (item: AgendaItem) => void;
}) {
  const { t } = useTranslation();
  const cancelled = item.cancelledAt !== null;
  return (
    <Card>
      <ItemLink href={paths.applicationSection(item.applicationId, INTERVIEWS)}>
        <AppText weight="semiBold" struck={cancelled}>
          {formats.time(item.scheduledAt)}
        </AppText>
        <View style={{ flex: 1 }}>
          <AppText variant="meta" tone="secondary">
            {t(
              cancelled
                ? "agendaChanges.cancelledInterview"
                : "agenda.interview",
            )}
          </AppText>
          <AppText weight="semiBold" struck={cancelled}>
            {item.jobTitle}
          </AppText>
          {item.employer ? (
            <AppText tone="secondary">{item.employer}</AppText>
          ) : null}
        </View>
      </ItemLink>
      {item.cancelledAt ? (
        <AppText tone="secondary">
          {t("agendaChanges.cancelledOn", {
            date: formats.date(item.cancelledAt),
          })}
        </AppText>
      ) : null}
      <AddToCalendar
        item={item}
        what={item.jobTitle}
        formats={formats}
        onAdd={onAdd}
      />
    </Card>
  );
}

/** A dated Coaching Session: its time, its Human Coach and duration, and « modifié par le coach » when they last changed it. */
function CoachingSessionRow({
  item,
  formats,
  onAdd,
}: {
  item: CoachingSessionAgendaItem;
  formats: Formats;
  onAdd: (item: AgendaItem) => void;
}) {
  const { t, i18n } = useTranslation();
  // « Espace coach v2 » off (ADR-0106): the time alone, in French time, beside the session, as before the epic.
  const coachSpaceV2 = useCoachSpaceV2();
  return (
    <Card>
      <ItemLink href={paths.coachingSession(item.id)}>
        {coachSpaceV2 ? null : <AppText weight="semiBold">{formats.time(item.scheduledAt)}</AppText>}
        <View style={{ flex: 1 }}>
          {coachSpaceV2 ? <AppText weight="semiBold">{coachingTime(new Date(item.scheduledAt), i18n.language, item.timeZone)}</AppText> : null}
          <AppText variant="meta" tone="secondary">
            {t("agenda.coachingSession")}
          </AppText>
          <AppText weight="semiBold">
            {t("agenda.withCoach", { name: item.coach.name })}
          </AppText>
          {item.durationMinutes ? (
            <AppText tone="secondary">
              {t("agenda.duration", { count: item.durationMinutes })}
            </AppText>
          ) : null}
          {coachSpaceV2 && item.changedBy === "cal_com" ? <AppText variant="meta">{t("coachingBooking.viaCal")}</AppText> : null}
          {item.changedBy === "coach" ? (
            <AppText variant="meta" tone="accent">
              {t("agenda.changedByCoach")}
            </AppText>
          ) : null}
        </View>
      </ItemLink>
      {coachSpaceV2 && item.meeting !== undefined ? <SessionJoin meeting={item.meeting} scheduledAt={item.scheduledAt} durationMinutes={item.durationMinutes} timeZone={item.timeZone} /> : null}
      <AddToCalendar
        item={item}
        what={t("agenda.calendarFile.sessionTitle", { name: item.coach.name })}
        formats={formats}
        onAdd={onAdd}
      />
    </Card>
  );
}
