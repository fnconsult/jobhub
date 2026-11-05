import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SIGN_IN_CODE_LENGTH, type SignInCodeRefusal } from "@jobhub/shared";
import { AppState, Platform, ScrollView, TextInput, View, type TextInputProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useForgetReads } from "../offline/read-cache";
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
 * waiting for it, or its code typed, #686); pending its second step (ADR-0075), that step to take (asked natively in its own ticket); signed in,
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

  const forgetReads = useForgetReads();
  const value = useMemo<SessionContextValue>(
    () => ({
      signOut: async () => {
        // The read cache goes first, a write still waiting included (#701), then the session is dropped.
        await forgetReads();
        await session.signOut();
        setState(SIGNED_OUT);
      },
    }),
    [session, forgetReads],
  );

  if (!state) return null;
  return (
    <SessionContext.Provider value={value}>
      {state.kind === "signedIn" ? children : state.kind === "secondStep" ? <SecondStep onSignOut={value.signOut} /> : <SignIn session={session} linkInvalid={linkInvalid} onAskLink={() => setLinkInvalid(false)} onSignedIn={setState} />}
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

type Step = { kind: "form"; error: boolean } | { kind: "sending" } | { kind: "sent"; email: string; refusal?: SignInCodeRefusal; checking?: boolean };
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

/**
 * The email's code (#686), as the system's keyboard and autofill read it: the number pad, and the code offered from
 * Mail or Messages (iOS `oneTimeCode`, Android's `sms-otp`).
 */
const CODE_FIELD = {
  autoCapitalize: "none",
  autoCorrect: false,
  autoComplete: Platform.OS === "android" ? "sms-otp" : "one-time-code",
  inputMode: "numeric",
  keyboardType: "number-pad",
  textContentType: "oneTimeCode",
  returnKeyType: "done",
  maxLength: SIGN_IN_CODE_LENGTH + 2,
} as const satisfies TextInputProps;

/**
 * Sign-in by magic link: the email, « Recevoir mon lien de connexion », then waiting for the link, or « Saisir le code
 * reçu par e-mail » beside it (#686): the code signs in here (`onSignedIn`) when the email is read on another device. A
 * link no longer valid (`linkInvalid`) is said on either step, until another is asked (`onAskLink`); a code refused,
 * until another is typed or another email asked.
 */
function SignIn({ session, linkInvalid, onAskLink, onSignedIn }: { session: AppSession; linkInvalid: boolean; onAskLink: () => void; onSignedIn: (state: SessionState) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>(FORM);

  const send = async () => {
    const address = email.trim();
    if (!address) return;
    onAskLink();
    setCode("");
    setStep(SENDING);
    setStep((await session.askLink(address)) ? { kind: "sent", email: address } : { kind: "form", error: true });
  };

  const enterCode = async (address: string) => {
    if (!code.trim()) return;
    setStep({ kind: "sent", email: address, checking: true });
    const outcome = await session.enterCode(address, code);
    if (outcome.kind === "codeRefused") setStep({ kind: "sent", email: address, refusal: outcome.reason });
    else onSignedIn(outcome);
  };

  if (step.kind === "sent") {
    return (
      <GateScreen title={t("signIn.title")}>
        {linkInvalid ? <SignInError message={t("signIn.linkError")} /> : null}
        <View role="status">
          <AppText>{t("mobile.signIn.sent", { email: step.email })}</AppText>
        </View>
        <AppText tone="secondary">{t("mobile.signIn.waiting")}</AppText>
        <View style={{ gap: space[2] }}>
          <AppText weight="semiBold">{t("signIn.codeLabel")}</AppText>
          <FieldInput label={t("signIn.codeLabel")} value={code} onChangeText={setCode} onSubmitEditing={() => void enterCode(step.email)} editable={!step.checking} {...CODE_FIELD} />
        </View>
        {step.refusal ? <SignInError message={t(step.refusal)} /> : null}
        <Control look="primary" label={step.checking ? t("signIn.codeChecking") : t("signIn.codeSubmit")} onPress={() => void enterCode(step.email)} />
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
      {error ? <SignInError message={error} /> : null}
      <View style={{ gap: space[2] }}>
        <AppText weight="semiBold">{t("signIn.emailLabel")}</AppText>
        <FieldInput label={t("signIn.emailLabel")} value={email} onChangeText={setEmail} onSubmitEditing={() => void send()} editable={!sending} {...EMAIL_FIELD} />
      </View>
      <Control look="primary" label={sending ? t("signIn.sending") : t("signIn.submit")} onPress={() => void send()} />
    </GateScreen>
  );
}

/** A text field of the sign-in screen, named by `label` (written above it). */
function FieldInput({ label, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return (
    <TextInput
      aria-label={label}
      {...props}
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
  );
}

/** What went wrong with the sign-in, read out as it appears. */
function SignInError({ message }: { message: string }) {
  return (
    <View role="alert">
      <AppText tone="danger">{message}</AppText>
    </View>
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
