import { legalStepsResponseSchema, type ShownLegalTextRead } from "@jobhub/shared/reads";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Square, SquareCheck } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi } from "../api/api";
import { read } from "../api/reads";
import { paths } from "../navigation/pages";
import { useSession } from "../session/SessionGate";
import { space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { SessionWebPage } from "../web-pages/WebPageScreen";
import { LegalTextView } from "./LegalTextView";

type Step = "acceptance" | "privacyChange" | "euAiConsent";

/** A Legal Text Version's day as the CGU box names it: « 01/12/2026 » in French, written out otherwise (as on the web). */
function versionDay(version: string, locale: string): string {
  if (locale === "fr") return version.split("-").reverse().join("/");
  return writtenDay(version, locale);
}

const writtenDay = (version: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${version}T00:00:00Z`));

/**
 * The legal steps after sign-in, native (#689, ADR-0062, ADR-0072, ADR-0076), the web's own asked the same way and
 * answered through the same routes, which record an Acceptance's origin as `mobile`: first the CGU version to accept,
 * before anything else (only Mes données and the subscription stay open meanwhile, as web pages); then the privacy
 * policy's change, shown once; then the EU AI Consent when it is missing, which « Plus tard » leaves for the next
 * launch. `children`, the app, once nothing is left; and at once when the steps cannot be read, as on the web.
 */
export function LegalSteps({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const steps = useQuery({
    queryKey: ["legalSteps", i18n.language],
    queryFn: () => read(api, `/api/account/legal-steps?lang=${encodeURIComponent(i18n.language)}`, legalStepsResponseSchema),
    retry: false,
    staleTime: Infinity,
    // Asked even when the device says it is offline: the answer, or the failure that lets the app go on, comes at once.
    networkMode: "always",
  });
  const [done, setDone] = useState<ReadonlySet<Step>>(new Set());
  const finish = (step: Step) => setDone((current) => new Set(current).add(step));

  const accepted = () => finish("acceptance");
  const closed = () => finish("privacyChange");
  const answered = () => finish("euAiConsent");

  if (steps.isPending) {
    return (
      <StepScreen>
        <ActivityIndicator accessibilityLabel={t("mobile.legalSteps.checking")} />
      </StepScreen>
    );
  }
  if (!steps.data) return children;
  const { acceptance, privacyChange, euAiConsentGiven } = steps.data;
  if (acceptance && !done.has("acceptance")) return <Acceptance cgu={acceptance} onAccepted={accepted} onStale={() => void steps.refetch()} />;
  if (privacyChange && !done.has("privacyChange")) return <PrivacyChange change={privacyChange} onClosed={closed} />;
  if (!euAiConsentGiven && !done.has("euAiConsent")) return <EuAiConsent onAnswered={answered} />;
  return children;
}

/** A step's screen, before the shell: the safe areas, a reading width. */
function StepScreen({ title, children }: { title?: string; children?: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1, padding: space[4], paddingTop: insets.top + space[4], paddingBottom: insets.bottom + space[4] }}
    >
      <View style={{ width: "100%", maxWidth: 40 * 16, alignSelf: "center", gap: space[4] }}>
        {title ? (
          <View role="heading">
            <AppText variant="h1">{title}</AppText>
          </View>
        ) : null}
        {children}
      </View>
    </ScrollView>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <View role="alert">
      <AppText tone="danger">{message}</AppText>
    </View>
  );
}

/** The CGU version to accept: its text, the box (never ticked for the Candidate), « Accepter et continuer ». */
function Acceptance({ cgu, onAccepted, onStale }: { cgu: ShownLegalTextRead; onAccepted: () => void; onStale: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const api = useApi();
  const { webPages } = useSession();
  const [ticked, setTicked] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const day = versionDay(cgu.version, i18n.language);

  if (open) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ alignItems: "flex-start", paddingHorizontal: space[2] }}>
          <Control icon={ArrowLeft} label={t("mobile.legalSteps.back")} onPress={() => setOpen(null)} />
        </View>
        <SessionWebPage path={open} />
      </View>
    );
  }

  const accept = async () => {
    setWorking(true);
    setFailed(false);
    try {
      const response = await api("/api/account/acceptances", { method: "POST", body: JSON.stringify({ text: "cgu", version: cgu.version, accepted: true }) });
      if (response.status === 409) {
        setTicked(false);
        onStale();
      } else if (response.ok) onAccepted();
      else throw new Error(String(response.status));
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <StepScreen title={t("acceptance.title")}>
      <AppText tone="secondary">{t("acceptance.intro")}</AppText>
      <LegalTextView text={cgu} webAppUrl={webPages.baseURL} />
      <Pressable
        role="checkbox"
        aria-checked={ticked}
        aria-label={t("acceptance.box", { date: day })}
        onPress={() => setTicked((current) => !current)}
        style={{ minHeight: TARGET, flexDirection: "row", alignItems: "center", gap: space[3] }}
      >
        {ticked ? <SquareCheck color={colors.accent} /> : <Square color={colors.text} />}
        <View style={{ flex: 1 }}>
          <AppText>{t("acceptance.box", { date: day })}</AppText>
        </View>
      </Pressable>
      <Control look="primary" label={working ? t("acceptance.sending") : t("acceptance.submit")} disabled={!ticked || working} onPress={() => void accept()} />
      {failed ? <Failure message={t("acceptance.error")} /> : null}
      <AppText tone="secondary">{t("mobile.legalSteps.meanwhile")}</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Control look="secondary" label={t("acceptance.data")} onPress={() => setOpen(paths.accountData)} />
        <Control look="secondary" label={t("acceptance.subscription")} onPress={() => setOpen(paths.subscription)} />
      </View>
    </StepScreen>
  );
}

/** The privacy policy's change (the Privacy change notice): its text, once, closed with « J'ai compris »; nothing blocked. */
function PrivacyChange({ change, onClosed }: { change: ShownLegalTextRead; onClosed: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { webPages } = useSession();
  const close = () => {
    // As on the web: closed at once, whether or not the web app hears of it now (it is shown again otherwise).
    void api(`/api/privacy-change/${encodeURIComponent(change.version)}`, { method: "DELETE" }).catch(() => {});
    onClosed();
  };
  return (
    <StepScreen title={t("privacyChange.label")}>
      <AppText>{t("privacyChange.message", { date: writtenDay(change.version, i18n.language) })}</AppText>
      <LegalTextView text={change} webAppUrl={webPages.baseURL} />
      <Control look="primary" label={t("privacyChange.dismiss")} onPress={close} />
    </StepScreen>
  );
}

/** The EU AI Consent, when it is missing: « Donner mon accord », or « Plus tard », which records nothing. */
function EuAiConsent({ onAnswered }: { onAnswered: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const give = async () => {
    setWorking(true);
    setFailed(false);
    try {
      const response = await api("/api/account/eu-ai-consent", { method: "PUT" });
      if (!response.ok) throw new Error(String(response.status));
      onAnswered();
    } catch {
      setFailed(true);
      setWorking(false);
    }
  };
  return (
    <StepScreen title={t("euAiConsent.title")}>
      <AppText>{t("euAiConsent.explanation")}</AppText>
      <Control look="primary" label={t("euAiConsent.give")} disabled={working} onPress={() => void give()} />
      <Control look="secondary" label={t("mobile.legalSteps.later")} disabled={working} onPress={onAnswered} />
      {failed ? <Failure message={t("euAiConsent.error")} /> : null}
    </StepScreen>
  );
}
