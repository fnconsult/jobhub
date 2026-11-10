import { SessionJoin } from "./SessionJoin";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { coachingResponseSchema, type CoachingResponse } from "@jobhub/shared/reads";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Linking, View } from "react-native";
import { useRead } from "../api/reads";
import { FRENCH_TIME_ZONE } from "../agenda/french-time";
import { paths } from "../navigation/pages";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { paymentReturn, paymentWait, readAgainWhileWaiting, usePendingCheckout, type PaymentWait } from "./payment-return";
import { SessionForm } from "./SessionForm";

type Session = CoachingResponse["sessions"][number];
type Coach = CoachingResponse["coaches"][number];

/** How the page writes its dates, in the Interface Language, in French time (ADR-0028), as the web's page does. */
function coachingFormats(locale: string, timeZone = FRENCH_TIME_ZONE) {
  const zone = { timeZone: FRENCH_TIME_ZONE };
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", ...zone });
  return {
    date: (instant: string) => date.format(new Date(instant)),
    dateTime: (instant: string) => coachingTime(new Date(instant), locale, timeZone),
    money: (amount: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100),
  };
}
type Formats = ReturnType<typeof coachingFormats>;

/** Mes coachs humains' read (`GET /api/coaching`, #684), kept on the device; read again while it waits for Stripe's webhook. */
const useCoaching = () => useRead("humanCoaches", "/api/coaching", coachingResponseSchema, [], true, { readAgain: readAgainWhileWaiting });

/**
 * What the page says of a Stripe Checkout the Candidate came back from (payment-return.ts): waiting for Stripe's webhook
 * (the page reads the web app again meanwhile, until it is slow), then the Coaching Session recorded, or that nothing was
 * paid. The outcome stays on the page until the Candidate leaves it.
 */
function usePaymentWait(coaching: ReturnType<typeof useCoaching>) {
  const wait = paymentWait(usePendingCheckout(), coaching.data, coaching.dataUpdatedAt);
  const settled = wait.kind === "recorded" || wait.kind === "cancelled";
  useFocusEffect(
    useCallback(() => {
      if (!settled) return undefined;
      return () => paymentReturn.done();
    }, [settled]),
  );
  return wait;
}

/**
 * Mes coachs humains (#694, ADR-0076), native: the menu's card in its Coach Conversation (MenuPages, ADR-0070), as on
 * the web: « Mes séances payées » (each Coaching Session with its status: dated, with its duration, video link and note,
 * or to schedule on the Human Coach's Cal.com page) then « Choisir un coach » (each Human Coach, whether they have Coach
 * Access, and « Réserver une séance avec … » while a Coaching Session can be paid). The price shown is the one the
 * Candidate pays for a Coaching Session: never a Plan's price, name or upgrade (App Store guideline 3.1.1). It does not
 * scroll by itself: the conversation's thread does.
 */
export function HumanCoaches() {
  const { t } = useTranslation();
  const pending = usePendingCheckout();
  const coaching = useCoaching();
  const wait = usePaymentWait(coaching);
  // Back from Checkout: read at once, whatever was read before it opened.
  const back = pending?.how ?? null;
  const { refetch } = coaching;
  useEffect(() => {
    if (back === "paid" || back === "closed") void refetch();
  }, [back, refetch]);
  // Back from a page of the web app (a Withdrawal) or the Agenda: read afresh.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  if (coaching.data) return <Loaded coaching={coaching.data} wait={wait} onRefresh={() => void refetch()} />;
  return (
    <View style={{ gap: space[3], alignItems: "flex-start" }}>
      {coaching.isError ? (
        <>
          <AppText tone="secondary">{t("mobile.coaching.loadError")}</AppText>
          <Control label={t("errorPage.actions.retry")} onPress={() => void coaching.refetch()} />
        </>
      ) : (
        <AppText tone="secondary">{t("mobile.coaching.loading")}</AppText>
      )}
    </View>
  );
}

function Loaded({ coaching, wait, onRefresh }: { coaching: CoachingResponse; wait: PaymentWait; onRefresh: () => void }) {
  const { t, i18n } = useTranslation();
  const formats = useMemo(() => coachingFormats(i18n.language, coaching.timeZone), [i18n.language, coaching.timeZone]);
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
      {session.meeting !== undefined ? <Control label={t("coachReports.open")} onPress={() => router.navigate(`/coachs/seances/${session.id}`)} /> : null}
      {session.meeting !== undefined ? <SessionJoin meeting={session.meeting} scheduledAt={session.scheduledAt} durationMinutes={session.durationMinutes} /> : session.videoLink ? <Control label={t("humanCoaches.joinVideo", { name })} onPress={() => void Linking.openURL(session.videoLink!).catch(() => {})} /> : null}
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
