import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SIGN_IN_CODE_LENGTH, signInCopy, type SignInCodeRefusal, type SignInProviderButton } from "@jobhub/shared";
import { DEFAULT_LOCALE, isSupportedLocale } from "@jobhub/shared/i18n";
import { AppState, Platform, View, type TextInputProps } from "react-native";
import { useForgetReads } from "../offline/read-cache";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { AppSession, SessionState } from "./app-session";
import { GateError, GateField, GateScreen } from "./GateScreen";
import { SecondStepScreen } from "./SecondStepScreen";

const SIGNED_OUT: SessionState = { kind: "signedOut" };

/**
 * The link each session's gate last opened. Forgetting the reads starts the gate again (ReadCacheProvider), with the
 * app's address unchanged: the link it signed in with is not opened a second time, to be told it is no longer valid.
 */
const OPENED = new WeakMap<AppSession, string>();

interface SessionContextValue {
  /** Revokes the session and empties secure storage (app-session.ts); the app is back on sign-in. */
  signOut: () => Promise<void>;
  /** Reads the session again from the web app, as when the app comes back to the foreground: signed out once it is gone. */
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
export function SessionGate({ session, link, children }: { session: AppSession; link: string | null; children: ReactNode }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const forgetReads = useForgetReads();
  // The state as last set, read when the session is found gone (a render may not have shown it yet).
  const known = useRef<SessionState | null>(null);
  const settle = useCallback(
    async (next: SessionState) => {
      // A session ended anywhere but the app's own sign-out (a web page in a WebView, the Account deleted there, a
      // revocation from Mon compte on the web, an expiry): its reads go too before sign-in shows, as at sign-out (#701),
      // so the next sign-in reads afresh (its CGU to accept among them). Forgetting starts this gate again, which then
      // finds the session gone with nothing known before: it forgets once.
      if (next.kind === "signedOut" && known.current && known.current.kind !== "signedOut") await forgetReads();
      known.current = next;
      setState(next);
    },
    [forgetReads],
  );

  const refresh = useCallback(
    () =>
      session.current().then(settle, () => {
        // Offline: as it was; signed out if nothing is known yet (the session stays in secure storage for the next time).
        known.current ??= SIGNED_OUT;
        setState(known.current);
      }),
    [session, settle],
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
      if (outcome.kind !== "invalidLink") void settle(outcome);
    });
    return () => {
      current = false;
    };
  }, [session, link, settle]);

  const value = useMemo<SessionContextValue>(
    () => ({
      signOut: async () => {
        // The read cache goes first, a write still waiting included (#701), then the session is dropped.
        await forgetReads();
        await session.signOut();
        known.current = SIGNED_OUT;
        setState(SIGNED_OUT);
      },
      recheck: refresh,
      webPages: session,
    }),
    [session, forgetReads, refresh],
  );

  if (!state) return null;
  return (
    <SessionContext.Provider value={value}>
      {state.kind === "signedIn" ? children : state.kind === "secondStep" ? <SecondStepScreen session={session} onSettled={settle} onSignOut={value.signOut} /> : <SignIn session={session} linkInvalid={linkInvalid} onAskLink={() => setLinkInvalid(false)} onSignedIn={settle} />}
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
 * Sign-in as on the web's sign-in page: « Continuer avec … » for each Sign-in Provider shown to Candidates (#687), which
 * opens it in the system's authentication browser, « ou », then the magic link: the email, « Recevoir mon lien de
 * connexion », then waiting for the link, or « Saisir le code reçu par e-mail » beside it (#686): the code signs in here
 * (`onSignedIn`) when the email is read on another device. The intro and a provider's refusal are the web's words
 * (signInCopy); a person closing the browser or leaving the provider's page is back on the screen as it was. A link no
 * longer valid (`linkInvalid`) is said on either step, until another is asked (`onAskLink`); a code refused, until
 * another is typed or another email asked.
 */
function SignIn({ session, linkInvalid, onAskLink, onSignedIn }: { session: AppSession; linkInvalid: boolean; onAskLink: () => void; onSignedIn: (state: SessionState) => void }) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>(FORM);
  const [providers, setProviders] = useState<SignInProviderButton[]>([]);
  /** The provider being signed in through, while the system's browser is open. */
  const [continuing, setContinuing] = useState<string | null>(null);
  /** The code the last sign-in through a provider came back refused with. */
  const [providerError, setProviderError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void session.providers().then((shown) => current && setProviders(shown));
    return () => {
      current = false;
    };
  }, [session]);

  const continueWith = async (providerId: string) => {
    onAskLink();
    setProviderError(null);
    setContinuing(providerId);
    const outcome = await session.continueWith(providerId);
    setContinuing(null);
    if (outcome.kind === "cancelled") return;
    if (outcome.kind === "providerRefused") setProviderError(outcome.error);
    else onSignedIn(outcome);
  };

  const send = async () => {
    const address = email.trim();
    if (!address) return;
    onAskLink();
    setProviderError(null);
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
  const copy = signInCopy({ providers: providers.map((provider) => provider.displayName), error: providerError }, isSupportedLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE);
  const error = step.kind === "form" && step.error ? t("signIn.error") : (copy.notice?.text ?? (linkInvalid ? t("signIn.linkError") : null));
  return (
    <GateScreen title={t("signIn.title")}>
      <AppText tone="secondary">{copy.intro}</AppText>
      {error ? <GateError message={error} /> : null}
      {providers.length > 0 ? (
        <View style={{ gap: space[2] }}>
          {providers.map((provider) => (
            <Control
              key={provider.id}
              look="secondary"
              label={t("signIn.continueWith", { provider: provider.displayName })}
              disabled={continuing !== null}
              onPress={() => void continueWith(provider.id)}
            />
          ))}
          <AppText tone="secondary" centered>
            {t("signIn.or")}
          </AppText>
        </View>
      ) : null}
      <GateField label={t("signIn.emailLabel")} value={email} onChangeText={setEmail} onSubmitEditing={() => void send()} editable={!sending} {...EMAIL_FIELD} />
      <Control look="primary" label={sending ? t("signIn.sending") : t("signIn.submit")} onPress={() => void send()} />
    </GateScreen>
  );
}
