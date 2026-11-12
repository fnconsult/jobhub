// Mes coachs humains as before the Human Coach epic (origin/main), shown while « Espace coach v2 » is off (ADR-0106):
// main's page below its read, copied verbatim (only the read and the payment wait stay in HumanCoaches.tsx, unchanged).
// #888 retires it with the old Coach space.
import type { CoachingResponse } from "@jobhub/shared/reads";
import { useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Linking, View } from "react-native";
import { FRENCH_TIME_ZONE } from "../agenda/french-time";
import { paths } from "../navigation/pages";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { PaymentWait } from "./payment-return";
import { SessionForm } from "./SessionForm";

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

export function LegacyLoaded({ coaching, wait, onRefresh }: { coaching: CoachingResponse; wait: PaymentWait; onRefresh: () => void }) {
  const { t, i18n } = useTranslation();
  const formats = useMemo(() => coachingFormats(i18n.language), [i18n.language]);
  return (
    <View style={{ gap: space[6] }}>
      <View style={{ gap: space[3] }}>
        <AppText variant="h3" heading>
          {t("humanCoaches.sessionsTitle")}
        </AppText>
        <PaymentNotice wait={wait} onRefresh={onRefresh} />
        {coaching.sessions.length === 0 ? <AppText tone="secondary">{t("humanCoachesMenu.sessionsNone")}</AppText> : null}
        {coaching.sessions.map((session) => (
          <SessionCard key={session.id} session={session} formats={formats} onSaved={onRefresh} />
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
    </View>
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

/**
 * A Coaching Session: dated (its date, duration, video link, note, « modifié par » the coach), or to schedule on Cal.com;
 * its date to enter or correct (SessionForm), and « Renoncer au contrat ici » while it can still be withdrawn from.
 */
function SessionCard({ session, formats, onSaved }: { session: Session; formats: Formats; onSaved: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const name = session.coach.name;
  const paidOn = t("humanCoaches.sessionPaidOn", { name, date: formats.date(session.paidAt) });
  const actions = editing ? (
    <SessionForm
      session={session}
      onSaved={() => {
        setEditing(false);
        onSaved();
      }}
      onCancel={() => setEditing(false)}
    />
  ) : (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
      <Control
        look="secondary"
        label={t(session.scheduledAt ? "coachingSession.edit" : "coachingSession.enterDate")}
        accessibleName={t(session.scheduledAt ? "coachingSession.editFor" : "coachingSession.enterDateFor", { name })}
        onPress={() => setEditing(true)}
      />
      {session.withdrawable ? (
        <Control label={t("withdrawals.page.title")} accessibleName={t("withdrawals.agenda.label", { name })} onPress={() => router.navigate(paths.withdrawal(`coaching-session:${session.id}`))} />
      ) : null}
    </View>
  );
  if (!session.scheduledAt) {
    return (
      <Card label={paidOn}>
        <AppText weight="semiBold">{paidOn}</AppText>
        <AppText tone="secondary">{t("humanCoaches.toSchedule")}</AppText>
        <Control look="primary" label={t("humanCoaches.pickSlot", { name })} onPress={() => void Linking.openURL(session.coach.bookingUrl).catch(() => {})} />
        {actions}
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
      {actions}
    </Card>
  );
}

/** What came of the Checkout the Candidate came back from, above the Coaching Sessions. */
function PaymentNotice({ wait, onRefresh }: { wait: PaymentWait; onRefresh: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (wait.kind === "none") return null;
  const message =
    wait.kind === "recorded"
      ? t("mobile.coaching.payment.recorded", { name: wait.session.coach.name })
      : wait.kind === "cancelled"
        ? t("mobile.coaching.payment.cancelled")
        : wait.slow
          ? t("mobile.coaching.payment.slow")
          : t(wait.paid ? "mobile.coaching.payment.waiting" : "mobile.coaching.payment.maybe");
  return (
    <View role="status" style={{ gap: space[2], padding: space[3], borderRadius: radius.card, backgroundColor: colors.hover }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        {wait.kind === "waiting" && !wait.slow ? <ActivityIndicator color={colors.accent} /> : null}
        <View style={{ flex: 1 }}>
          <AppText>{message}</AppText>
        </View>
      </View>
      {wait.kind === "waiting" && wait.slow ? (
        <View style={{ alignSelf: "flex-start" }}>
          <Control look="secondary" label={t("mobile.coaching.payment.refresh")} onPress={onRefresh} />
        </View>
      ) : null}
    </View>
  );
}

/** A Human Coach: their bio, whether they have Coach Access, and « Réserver une séance avec … » while one can be paid. */
function CoachCard({ coach, bookable }: { coach: Coach; bookable: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card label={coach.name}>
      <AppText variant="h3">{coach.name}</AppText>
      {coach.bio ? <AppText>{coach.bio}</AppText> : null}
      <AppText tone="secondary">{t(coach.accessGranted ? "humanCoaches.accessGranted" : "humanCoaches.accessNotGranted", { name: coach.name })}</AppText>
      {bookable ? <Control look="primary" label={t("humanCoaches.book", { name: coach.name })} onPress={() => router.navigate(paths.coachingOrder(coach.id))} /> : null}
    </Card>
  );
}
