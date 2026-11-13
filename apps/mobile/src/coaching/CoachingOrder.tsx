import { coachingOrderResponseSchema, coachingResponseSchema, type CoachingOrderResponse, type CoachingResponse } from "@jobhub/shared/reads";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { useApi, type ApiFetch } from "../api/api";
import { read } from "../api/reads";
import { useCoachSpaceV2 } from "../navigation/human-coach";
import { paths } from "../navigation/pages";
import { readKey, useOnline } from "../offline/read-cache";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Checkbox } from "../ui/Checkbox";
import { Control } from "../ui/Control";
import { inAppBrowser } from "./in-app-browser";
import { paymentReturn } from "./payment-return";

/** The value of the Immediate Performance Request box, ticked, as the web's Order page posts it (IMMEDIATE_EXECUTION_REQUESTED). */
const IMMEDIATE_EXECUTION_REQUESTED = "yes";

/** A CGV version's day as its box names it: « 01/10/2026 » in French, written out otherwise (as on the web). */
function versionDay(version: string, locale: string): string {
  if (locale === "fr") return version.split("-").reverse().join("/");
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${version}T00:00:00Z`));
}

/** Why « Passer au paiement » opened nothing: the CGV box of the version in effect not ticked, or the server failed. */
type Refusal = "cgv_required" | "failed";

/**
 * « Passer au paiement »: the web app checks the boxes and creates the Checkout Session (`POST /api/coaching/order`,
 * Orders.place), whose address it answers; Stripe Checkout then opens in the in-app browser. The Coaching Sessions known
 * now are kept, so Mes coachs humains can tell the one Stripe's webhook records (payment-return.ts).
 */
async function placeOrder(api: ApiFetch, coachId: string, answers: { cgv: string | null; immediateExecution: boolean }, known: () => Promise<readonly string[] | null>): Promise<Refusal | null> {
  let url: string;
  try {
    const response = await api("/api/coaching/order", {
      method: "POST",
      body: JSON.stringify({ coachId, cgv: answers.cgv, immediateExecution: answers.immediateExecution ? IMMEDIATE_EXECUTION_REQUESTED : null }),
    });
    if (response.status === 400) return "cgv_required";
    if (!response.ok) return "failed";
    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url !== "string" || !/^https:\/\//.test(body.url)) return "failed";
    url = body.url;
  } catch {
    return "failed";
  }
  paymentReturn.started(await known());
  await inAppBrowser.open(url).catch(() => {});
  paymentReturn.closed();
  return null;
}

/**
 * The Order of a Coaching Session in the app (#694, ADR-0074), as the web's Order page (`/coachs/commande?coach=`):
 * the summary (the Human Coach, the Candidate's Coaching Session Price all taxes included, paid once), the CGV box with
 * its version to read in the app, and the Immediate Performance Request, which also says that the right of withdrawal
 * is lost once the session is held; neither box is ever ticked for the Candidate. « Passer au paiement » waits for the
 * CGV box, then opens Stripe Checkout in the in-app browser (App Store guideline 3.1.3(d)) and goes back to Mes coachs
 * humains, where the Coaching Session shows once Stripe's webhook has recorded it.
 */
export function CoachingOrder() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  const online = useOnline();
  const { coach = "" } = useLocalSearchParams<{ coach?: string }>();
  const order = useQuery({
    queryKey: ["coachingOrder", coach],
    queryFn: () => read(api, `/api/coaching/order?coach=${encodeURIComponent(coach)}`, coachingOrderResponseSchema),
    retry: false,
    enabled: coach !== "",
  });
  const [cgvTicked, setCgvTicked] = useState(false);
  const [immediate, setImmediate] = useState(false);
  const [working, setWorking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  if (!order.data) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space[4], padding: space[4] }}>
        <AppText tone="secondary" centered>
          {order.isError || coach === "" ? t("orders.page.nothing") : t("mobile.coaching.order.loading")}
        </AppText>
        {order.isError || coach === "" ? <Control label={t("orders.page.back")} onPress={() => router.navigate(paths.humanCoaches)} /> : null}
      </View>
    );
  }
  const { cgv, price } = order.data;

  /** The Coaching Sessions known before Checkout: as last read, or read now. */
  const known = async () => {
    const read_ = (data: CoachingResponse | undefined) => data?.sessions.map((session) => session.id) ?? null;
    const cached = read_(queryClient.getQueryData<CoachingResponse>(readKey("humanCoaches")));
    if (cached) return cached;
    return read_(await read(api, "/api/coaching", coachingResponseSchema).catch(() => undefined));
  };

  const pay = async () => {
    setWorking(true);
    setRefusal(null);
    const refused = await placeOrder(api, coach, { cgv: cgv && cgvTicked ? cgv.version : null, immediateExecution: immediate }, known);
    setWorking(false);
    if (refused === "cgv_required") {
      // A new CGV version took effect while the Order was open: its box, unticked, to accept.
      setCgvTicked(false);
      void order.refetch();
    }
    setRefusal(refused);
    if (!refused) router.navigate(paths.humanCoaches);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4] }}>
      <AppText>{t("orders.page.intro")}</AppText>
      <Summary order={order.data} />
      {cgv ? (
        <View style={{ gap: space[2] }}>
          {i18n.language !== "fr" ? <AppText tone="secondary">{t("legal.translation")}</AppText> : null}
          <ReadLink label={t("orders.page.readCgv", { date: versionDay(cgv.version, i18n.language) })} onPress={() => router.navigate(cgv.url)} />
          <Checkbox label={t("orders.page.cgvBox", { date: versionDay(cgv.version, i18n.language) })} checked={cgvTicked} onChange={setCgvTicked} />
        </View>
      ) : null}
      <Checkbox label={t("orders.page.immediateSession")} hint={t("orders.page.immediateHint")} checked={immediate} onChange={setImmediate} />
      <AppText tone="secondary">{t("orders.page.withdrawal")}</AppText>
      {refusal ? (
        <View role="alert">
          <AppText tone="danger">{t(refusal === "cgv_required" ? "orders.page.cgvRequired" : "mobile.coaching.order.failed")}</AppText>
        </View>
      ) : null}
      {online ? null : <AppText tone="secondary">{t("mobile.offline.writeDisabled")}</AppText>}
      <View style={{ gap: space[2] }}>
        <Control
          look="primary"
          label={working ? t("mobile.coaching.order.opening") : t("orders.page.submit")}
          disabled={working || !online || (cgv !== null && !cgvTicked) || price === null}
          onPress={() => void pay()}
        />
        <AppText variant="meta" tone="secondary">
          {t("mobile.coaching.order.inBrowser")}
        </AppText>
        <Control label={t("orders.page.back")} onPress={() => router.navigate(paths.humanCoaches)} />
      </View>
    </ScrollView>
  );
}

/** « Récapitulatif »: what is bought, its price all taxes included, paid once. */
function Summary({ order }: { order: CoachingOrderResponse }) {
  const { t, i18n } = useTranslation();
  // « Espace coach v2 » off (ADR-0107): no Seller, as before the epic.
  const coachSpaceV2 = useCoachSpaceV2();
  const { colors } = useTheme();
  const price = order.price ? t("orders.priceOnce", { price: new Intl.NumberFormat(i18n.language, { style: "currency", currency: order.price.currency }).format(order.price.amount / 100) }) : t("orders.page.priceUnknown");
  const rows: [string, string][] = [
    [t("orders.page.item"), t("orders.email.coachingSession", { coach: order.coach.name })],
    ...(coachSpaceV2 && order.seller?[[t("coachingOffers.soldByLabel"),order.seller.name] as [string,string],...(order.seller.kind!=="jobbbox"?[[t("coachingOffers.identity"),`${order.seller.status} · SIRET ${order.seller.siret}`] as [string,string],[t("coachingOffers.marketplaceLabel"),t("coachingOffers.marketplace")] as [string,string]]:[])]:[]),
    [t("orders.page.price"), price],
    [t("orders.page.renewal"), t("orders.renewal.session")],
  ];
  return (
    <View style={{ gap: space[3], padding: space[3], borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, backgroundColor: colors.surface }}>
      <AppText variant="h3" heading>
        {t("orders.page.summaryTitle")}
      </AppText>
      {rows.map(([term, value]) => (
        <View key={term}>
          <AppText variant="meta" tone="secondary">
            {term}
          </AppText>
          <AppText weight="semiBold">{value}</AppText>
        </View>
      ))}
    </View>
  );
}

/** A link to a page of the app: the CGV version, read in the app. */
function ReadLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable role="link" aria-label={label} onPress={onPress} style={({ pressed }) => ({ minHeight: TARGET, justifyContent: "center", backgroundColor: pressed ? colors.hover : "transparent" })}>
      <AppText tone="accent">{label}</AppText>
    </Pressable>
  );
}
