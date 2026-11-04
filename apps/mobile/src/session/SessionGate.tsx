import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AppState, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { INTER, radius, space, TARGET, type, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { AppSession, SessionState } from "./app-session";

const SIGNED_OUT: SessionState = { kind: "signedOut" };

interface SessionContextValue {
  /** Revokes the session and empties secure storage (app-session.ts); the app is back on sign-in. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({ signOut: async () => {} });

/** What the signed-in app can do with its session: sign out (Mon compte). */
export const useSession = () => useContext(SessionContext);

/**
 * The app behind its session (#685, ADR-0076): signed out, the native sign-in screen (an email, the link sent, then
 * waiting for it); pending its second step (ADR-0075), that step to take (asked natively in its own ticket); signed in,
 * `children`. `link` is the address the app was last opened with (a universal link or an App Link): a magic link
 * signs in. The session is asked again each time the app comes back to the foreground, so a revocation from Mon compte
 * on the web signs the app out at that request.
 */
export function SessionGate({ session, link, children }: { session: AppSession; link: string | null; children: ReactNode }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);

  const refresh = useCallback(
    () =>
      session.current().then(setState, () =>
        // Offline: as it was; signed out if nothing is known yet (the session stays in secure storage for the next time).
        setState((current) => current ?? SIGNED_OUT),
      ),
    [session],
  );

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") void refresh();
    });
    return () => subscription?.remove();
  }, [refresh]);

  useEffect(() => {
    if (!link) return;
    let current = true;
    void session.openLink(link).then((outcome) => {
      if (!current || !outcome) return;
      setLinkInvalid(outcome.kind === "invalidLink");
      if (outcome.kind !== "invalidLink") setState(outcome);
    });
    return () => {
      current = false;
    };
  }, [session, link]);

  const value = useMemo<SessionContextValue>(
    () => ({
      signOut: async () => {
        await session.signOut();
        setState(SIGNED_OUT);
      },
    }),
    [session],
  );

  if (!state) return null;
  return (
    <SessionContext.Provider value={value}>
      {state.kind === "signedIn" ? children : state.kind === "secondStep" ? <SecondStep onSignOut={value.signOut} /> : <SignIn session={session} linkInvalid={linkInvalid} />}
    </SessionContext.Provider>
  );
}

const CENTRED = { flexGrow: 1, justifyContent: "center", padding: space[4] } as const;

/** A screen of its own, before the shell: the safe areas, a reading width, centred. */
function GateScreen({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ ...CENTRED, paddingTop: insets.top + space[4], paddingBottom: insets.bottom + space[4] }}
      keyboardShouldPersistTaps={TAPS_REACH_CONTROLS}
    >
      <View style={{ width: "100%", maxWidth: 28 * 16, alignSelf: "center", gap: space[4] }}>
        <AppText variant="h1">{title}</AppText>
        {children}
      </View>
    </ScrollView>
  );
}

type Step = { kind: "form"; error: boolean } | { kind: "sending" } | { kind: "sent"; email: string };
const FORM: Step = { kind: "form", error: false };
const SENDING: Step = { kind: "sending" };
/** With the keyboard up, a tap on « Recevoir mon lien de connexion » presses it rather than only closing the keyboard. */
const TAPS_REACH_CONTROLS = "handled";
/** The email field, as the system's keyboard and autofill read it. */
const EMAIL_FIELD = {
  autoCapitalize: "none",
  autoCorrect: false,
  autoComplete: "email",
  inputMode: "email",
  keyboardType: "email-address",
  textContentType: "emailAddress",
  returnKeyType: "send",
} as const;

/** Sign-in by magic link: the email, « Recevoir mon lien de connexion », then waiting for the link. */
function SignIn({ session, linkInvalid }: { session: AppSession; linkInvalid: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>(FORM);

  const send = async () => {
    const address = email.trim();
    if (!address) return;
    setStep(SENDING);
    setStep((await session.askLink(address)) ? { kind: "sent", email: address } : { kind: "form", error: true });
  };

  if (step.kind === "sent") {
    return (
      <GateScreen title={t("signIn.title")}>
        <View role="status">
          <AppText>{t("mobile.signIn.sent", { email: step.email })}</AppText>
        </View>
        <AppText tone="secondary">{t("mobile.signIn.waiting")}</AppText>
        <View style={{ gap: space[2] }}>
          <Control look="secondary" label={t("mobile.signIn.resend")} onPress={() => void send()} />
          <Control label={t("mobile.signIn.changeEmail")} onPress={() => setStep(FORM)} />
        </View>
      </GateScreen>
    );
  }

  const sending = step.kind === "sending";
  const error = step.kind === "form" && step.error ? t("signIn.error") : linkInvalid ? t("signIn.linkError") : null;
  return (
    <GateScreen title={t("signIn.title")}>
      <AppText tone="secondary">{t("signIn.introWithoutProviders")}</AppText>
      {error ? (
        <View role="alert">
          <AppText tone="danger">{error}</AppText>
        </View>
      ) : null}
      <View style={{ gap: space[2] }}>
        <AppText weight="semiBold">{t("signIn.emailLabel")}</AppText>
        <TextInput
          aria-label={t("signIn.emailLabel")}
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={() => void send()}
          editable={!sending}
          {...EMAIL_FIELD}
          style={{
            minHeight: TARGET,
            paddingHorizontal: space[3],
            borderWidth: 1,
            borderColor: colors.borderStrong,
            borderRadius: radius.control,
            fontFamily: INTER.regular,
            fontSize: type.fontSize.body,
            color: colors.text,
          }}
        />
      </View>
      <Control look="primary" label={sending ? t("signIn.sending") : t("signIn.submit")} onPress={() => void send()} />
    </GateScreen>
  );
}

/** A session pending its second step (ADR-0075): the step to take; asked natively in the second step's own ticket. */
function SecondStep({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { t } = useTranslation();
  return (
    <GateScreen title={t("twoStep.secondStep.title")}>
      <AppText>{t("mobile.secondStep.intro")}</AppText>
      <AppText tone="secondary">{t("mobile.secondStep.comingSoon")}</AppText>
      <Control look="secondary" label={t("twoStep.secondStep.signOut")} onPress={() => void onSignOut()} />
    </GateScreen>
  );
}
