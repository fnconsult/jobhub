import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AppState, View } from "react-native";
import { useForgetReads } from "../offline/read-cache";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { AppSession, SessionState } from "./app-session";
import { GateError, GateField, GateScreen } from "./GateScreen";
import { SecondStepScreen } from "./SecondStepScreen";

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
 * waiting for it); pending its second step (ADR-0075), that step, native (SecondStepScreen, #688); signed in,
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
      {state.kind === "signedIn" ? children : state.kind === "secondStep" ? <SecondStepScreen session={session} onSettled={setState} onSignOut={value.signOut} /> : <SignIn session={session} linkInvalid={linkInvalid} onAskLink={() => setLinkInvalid(false)} />}
    </SessionContext.Provider>
  );
}

type Step = { kind: "form"; error: boolean } | { kind: "sending" } | { kind: "sent"; email: string };
const FORM: Step = { kind: "form", error: false };
const SENDING: Step = { kind: "sending" };
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
 * Sign-in by magic link: the email, « Recevoir mon lien de connexion », then waiting for the link. A link no longer
 * valid (`linkInvalid`) is said on either step, until another is asked (`onAskLink`).
 */
function SignIn({ session, linkInvalid, onAskLink }: { session: AppSession; linkInvalid: boolean; onAskLink: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>(FORM);

  const send = async () => {
    const address = email.trim();
    if (!address) return;
    onAskLink();
    setStep(SENDING);
    setStep((await session.askLink(address)) ? { kind: "sent", email: address } : { kind: "form", error: true });
  };

  if (step.kind === "sent") {
    return (
      <GateScreen title={t("signIn.title")}>
        {linkInvalid ? <GateError message={t("signIn.linkError")} /> : null}
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
      {error ? <GateError message={error} /> : null}
      <GateField label={t("signIn.emailLabel")} value={email} onChangeText={setEmail} onSubmitEditing={() => void send()} editable={!sending} {...EMAIL_FIELD} />
      <Control look="primary" label={sending ? t("signIn.sending") : t("signIn.submit")} onPress={() => void send()} />
    </GateScreen>
  );
}
