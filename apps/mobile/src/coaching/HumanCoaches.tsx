import { coachingResponseSchema, type CoachingResponse } from "@jobhub/shared/reads";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Linking, ScrollView, View } from "react-native";
import { useRead } from "../api/reads";
import { FRENCH_TIME_ZONE } from "../agenda/french-time";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

type Session = CoachingResponse["sessions"][number];
type Coach = CoachingResponse["coaches"][number];

/** How the page writes its dates, in the Interface Language, in French time (ADR-0028), as the web's page does. */
function coachingFormats(locale: string) {
  const zone = { timeZone: FRENCH_TIME_ZONE };
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", ...zone });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", ...zone });
  return {
    date: (instant: string) => date.format(new Date(instant)),
    dateTime: (instant: string) => dateTime.format(new Date(instant)),
    money: (amount: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100),
  };
}
type Formats = ReturnType<typeof coachingFormats>;

/** Mes coachs humains' read (`GET /api/coaching`, #684), kept on the device for when there is no network. */
export const useCoaching = () => useRead("humanCoaches", "/api/coaching", coachingResponseSchema);

/**
 * Mes coachs humains (#694, ADR-0076), native: the menu's card as on the web, « Mes séances payées » (each Coaching
 * Session with its status: dated, with its duration, video link and note, or to schedule on the Human Coach's Cal.com
 * page) then « Choisir un coach » (each Human Coach, whether they have Coach Access, and « Réserver une séance avec … »
 * while a Coaching Session can be paid). The price shown is the one the Candidate pays for a Coaching Session: never a
 * Plan's price, name or upgrade (App Store guideline 3.1.1).
 */
export function HumanCoaches() {
  const { t } = useTranslation();
  const coaching = useCoaching();
  if (coaching.data) return <Loaded coaching={coaching.data} />;
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space[4], padding: space[4] }}>
      {coaching.isError ? (
        <>
          <AppText tone="secondary" centered>
            {t("mobile.coaching.loadError")}
          </AppText>
          <Control label={t("errorPage.actions.retry")} onPress={() => void coaching.refetch()} />
        </>
      ) : (
        <AppText tone="secondary" centered>
          {t("mobile.coaching.loading")}
        </AppText>
      )}
    </View>
  );
}

function Loaded({ coaching }: { coaching: CoachingResponse }) {
  const { t, i18n } = useTranslation();
  const formats = useMemo(() => coachingFormats(i18n.language), [i18n.language]);
  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[6] }}>
      <View style={{ gap: space[3] }}>
        <AppText variant="h3" heading>
          {t("humanCoaches.sessionsTitle")}
        </AppText>
        {coaching.sessions.length === 0 ? <AppText tone="secondary">{t("humanCoachesMenu.sessionsNone")}</AppText> : null}
        {coaching.sessions.map((session) => (
          <SessionCard key={session.id} session={session} formats={formats} />
        ))}
      </View>
      <View style={{ gap: space[3] }}>
        <AppText variant="h3" heading>
          {t("humanCoaches.listTitle")}
        </AppText>
        <AppText tone="secondary">{t("humanCoaches.accessIntro")}</AppText>
        <AppText>{coaching.price ? t("humanCoaches.price", { price: formats.money(coaching.price.amount, coaching.price.currency) }) : t("humanCoaches.unavailable")}</AppText>
        {coaching.coaches.length === 0 ? <AppText tone="secondary">{t("humanCoaches.none")}</AppText> : null}
        {coaching.coaches.map((coach) => (
          <CoachCard key={coach.id} coach={coach} bookable={coaching.price !== null} />
        ))}
      </View>
    </ScrollView>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View aria-label={label} style={{ gap: space[2], padding: space[3], borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, backgroundColor: colors.surface }}>
      {children}
    </View>
  );
}

/** A Coaching Session: dated (its date, duration, video link, note, « modifié par » the coach), or to schedule on Cal.com. */
function SessionCard({ session, formats }: { session: Session; formats: Formats }) {
  const { t } = useTranslation();
  const name = session.coach.name;
  const paidOn = t("humanCoaches.sessionPaidOn", { name, date: formats.date(session.paidAt) });
  if (!session.scheduledAt) {
    return (
      <Card label={paidOn}>
        <AppText weight="semiBold">{paidOn}</AppText>
        <AppText tone="secondary">{t("humanCoaches.toSchedule")}</AppText>
        <Control look="primary" label={t("humanCoaches.pickSlot", { name })} onPress={() => void Linking.openURL(session.coach.bookingUrl).catch(() => {})} />
      </Card>
    );
  }
  const on = t("humanCoaches.sessionOn", { name, date: formats.dateTime(session.scheduledAt) });
  return (
    <Card label={on}>
      <AppText weight="semiBold">{on}</AppText>
      {session.durationMinutes ? <AppText>{t("humanCoaches.sessionDuration", { count: session.durationMinutes })}</AppText> : null}
      {session.note ? <AppText>{session.note}</AppText> : null}
      {session.changedBy === "coach" ? (
        <AppText variant="meta" tone="accent">
          {t("humanCoaches.changedByCoach", { name })}
        </AppText>
      ) : null}
      <AppText variant="meta" tone="secondary">
        {paidOn}
      </AppText>
      {session.videoLink ? <Control label={t("humanCoaches.joinVideo", { name })} onPress={() => void Linking.openURL(session.videoLink!).catch(() => {})} /> : null}
    </Card>
  );
}

/** A Human Coach: their bio, whether they have Coach Access, and « Réserver une séance avec … » while one can be paid. */
function CoachCard({ coach, bookable }: { coach: Coach; bookable: boolean }) {
  const { t } = useTranslation();
  return (
    <Card label={coach.name}>
      <AppText variant="h3">{coach.name}</AppText>
      {coach.bio ? <AppText>{coach.bio}</AppText> : null}
      <AppText tone="secondary">{t(coach.accessGranted ? "humanCoaches.accessGranted" : "humanCoaches.accessNotGranted", { name: coach.name })}</AppText>
      {bookable ? <Control look="primary" label={t("humanCoaches.book", { name: coach.name })} onPress={() => {}} /> : null}
    </Card>
  );
}
