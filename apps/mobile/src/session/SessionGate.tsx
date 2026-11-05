import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SIGN_IN_CODE_LENGTH, type SignInCodeRefusal } from "@jobhub/shared";
import { AppState, Platform, View, type TextInputProps } from "react-native";
import { useForgetReads } from "../offline/read-cache";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { AppSession, SessionState } from "./app-session";
import { GateError, GateField, GateScreen } from "./GateScreen";
import { SecondStepScreen } from "./SecondStepScreen";

const SIGNED_OUT: SessionState = { kind: "signedOut" };

/** The session as the gate knows it; `offline`: not known, the web app could not be asked (it may still be valid). */
type GateState = SessionState & { offline?: true };
const UNKNOWN_OFFLINE: GateState = { kind: "signedOut", offline: true };

/**
 * The link each session's gate last opened: should the gate start again with the app's address unchanged, the link it
 * signed in with is not opened a second time, to be told it is no longer valid.
 */
const OPENED = new WeakMap<AppSession, string>();

interface SessionContextValue {
  /** Revokes the session and empties secure storage (app-session.ts); the app is back on sign-in. */
  signOut: () => Promise<void>;
  /**
   * Reads the session again from the web app, as when the app comes back to the foreground: signed out once it is gone.
   * A read answered 401 does (src/api/reads.ts), and a web page that lands on sign-in (src/web-pages).
   */
  recheck: () => Promise<void>;
  /** The web app whose pages open inside the app (src/web-pages), and the session's cookies they are given. */
  webPages: Pick<AppSession, "baseURL" | "webCookies" | "cookie">;
}

const SessionContext = createContext<SessionContextValue>({
  signOut: async () => {},
  recheck: async () => {},
  webPages: { baseURL: "", webCookies: async () => [], cookie: async () => "" },
});

/** What the signed-in app can do with its session: sign out (Mon compte), read it again, open the web app's pages. */
export const useSession = () => useContext(SessionContext);

/**
 * The app behind its session (#685, ADR-0076): signed out, the native sign-in screen (an email, the link sent, then
 * waiting for it, or its code typed, #686); pending its second step (ADR-0075), that step, native (SecondStepScreen,
 * #688), whether the session came by link or by code; signed in,
 * `children`. `link` is the address the app was last opened with (a universal link or an App Link): a magic link
 * signs in. The session is asked again each time the app comes back to the foreground, so a revocation from Mon compte
 * on the web signs the app out at that request.
 */
export function SessionGate({
  session,
  link,
  forgetOnDevice,
  children,
}: {
  session: AppSession;
  link: string | null;
  /** What the device keeps for the session, besides the session itself, forgotten once it ends (the Tailored Documents downloaded). */
  forgetOnDevice?: () => Promise<void>;
  children: ReactNode;
}) {
  const [state, setState] = useState<GateState | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  // Everything the device kept for a session, forgotten in this one place once it ends, however it ends, and before
  // another starts (#695): the reads, in memory and on the device, a write still waiting included (#701), so the next
  // sign-in reads afresh (its CGU to accept among them, #689); the WebViews' cookies (#689); and `forgetOnDevice`.
  // Nothing below the gate is shown then, so the screens need not start again.
  const forgetReads = useForgetReads();
  const forgetSession = useCallback(async () => {
    await forgetReads({ restart: false }).catch(() => undefined);
    await session.forgetWebViews().catch(() => undefined);
    if (forgetOnDevice) await forgetOnDevice().catch(() => undefined);
  }, [forgetReads, session, forgetOnDevice]);

  // Signed out here, revoked from Mon compte, expired, a read answered 401, a web page in a WebView that lands on
  // sign-in (signed out there, or the Account deleted): whichever way the web app says the session ended, or found
  // ended at launch. Not while the web app cannot be asked: the session may still be valid.
  const ended = state !== null && state.kind !== "signedIn" && !state.offline;
  useEffect(() => {
    if (ended) void forgetSession();
  }, [ended, forgetSession]);

  /** A sign-in (a link, a code) starts afresh: nothing of a session before it, even one not known to have ended. */
  const startSession = useCallback(
    async (outcome: SessionState) => {
      if (outcome.kind === "signedIn") {
        setState(null);
        await forgetSession();
      }
      setState(outcome);
    },
    [forgetSession],
  );

  const settle = useCallback((outcome: SessionState) => void startSession(outcome), [startSession]);

  const refresh = useCallback(
    () =>
      session.current().then(setState, async () => {
        // Offline: as it was; signed out if nothing is known yet, the session staying in secure storage for the next
        // time. With no session stored there is none to be valid: signed out, and what the device kept is forgotten.
        const stored = await session.cookie().catch(() => "");
        setState((current) => current ?? (stored ? UNKNOWN_OFFLINE : SIGNED_OUT));
      }),
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
    if (!link || OPENED.get(session) === link) return;
    let current = true;
    void session.openLink(link).then((outcome) => {
      OPENED.set(session, link);
      if (!current || !outcome) return;
      setLinkInvalid(outcome.kind === "invalidLink");
      if (outcome.kind !== "invalidLink") void startSession(outcome);
    });
    return () => {
      current = false;
    };
  }, [session, link, startSession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      // ADR-0076: what the device kept is forgotten before the session is dropped, so a sign-out cut short (the app
      // killed) never leaves it without its session. The screens go first, so none reads again in between. From the
      // app and from the second step alike.
      signOut: async () => {
        setState(null);
        await forgetSession();
        await session.signOut();
        setState(SIGNED_OUT);
      },
      recheck: refresh,
      webPages: session,
    }),
    [session, refresh, forgetSession],
  );

  if (!state) return null;
  return (
    <SessionContext.Provider value={value}>
      {state.kind === "signedIn" ? (
        children
      ) : state.kind === "secondStep" ? (
        // The second step taken, the session starts afresh, as any sign-in does: nothing of an earlier one shows.
        <SecondStepScreen session={session} onSettled={settle} onSignOut={value.signOut} />
      ) : (
        <SignIn session={session} linkInvalid={linkInvalid} onAskLink={() => setLinkInvalid(false)} onSignedIn={settle} />
      )}
    </SessionContext.Provider>
  );
}

type Step = { kind: "form"; error: boolean } | { kind: "sending" } | { kind: "sent"; email: string; refusal?: SignInCodeRefusal; checking?: boolean };
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
        {linkInvalid ? <GateError message={t("signIn.linkError")} /> : null}
        <View role="status">
          <AppText>{t("mobile.signIn.sent", { email: step.email })}</AppText>
        </View>
        <AppText tone="secondary">{t("mobile.signIn.waiting")}</AppText>
        <GateField label={t("signIn.codeLabel")} value={code} onChangeText={setCode} onSubmitEditing={() => void enterCode(step.email)} editable={!step.checking} {...CODE_FIELD} />
        {step.refusal ? <GateError message={t(step.refusal)} /> : null}
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
      {error ? <GateError message={error} /> : null}
      <GateField label={t("signIn.emailLabel")} value={email} onChangeText={setEmail} onSubmitEditing={() => void send()} editable={!sending} {...EMAIL_FIELD} />
      <Control look="primary" label={sending ? t("signIn.sending") : t("signIn.submit")} onPress={() => void send()} />
    </GateScreen>
  );
}
