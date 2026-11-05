import { SECOND_STEP_PATH } from "@jobhub/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { WebPage } from "../web-pages/WebPage";
import type { AppSession, SecondStepChoice, SecondStepOutcome, SessionState } from "./app-session";
import { GateError, GateField, GateScreen } from "./GateScreen";

type Loaded = { kind: "loading" } | { kind: "unreachable" } | SecondStepChoice;
type Refusal = Extract<SecondStepOutcome, { ok: false }>;

/**
 * The second step of a session pending it (ADR-0075, #688), native: « Utiliser une clé d'accès » when the account has
 * one and the device can use it, the authenticator app's code or a backup code, as on the web's page and on its
 * endpoints. An account that must have it and has no factor yet (a Human Coach) sets it up on the web's page, in a
 * WebView, then comes back. Signing out stays the other way out. `onSettled` with the session once it is no longer
 * pending (or no longer there).
 */
export function SecondStepScreen({ session, onSettled, onSignOut }: { session: AppSession; onSettled: (state: SessionState) => void; onSignOut: () => Promise<void> }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [settingUp, setSettingUp] = useState(false);

  const load = useCallback(
    () =>
      session
        .secondStep()
        // Nothing pending any more (done elsewhere, or signed out): the session as it is now.
        .then(async (choice) => (choice ? setLoaded(choice) : onSettled(await session.current())))
        .catch(() => setLoaded({ kind: "unreachable" })),
    [session, onSettled],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const reload = () => {
    setLoaded({ kind: "loading" });
    void load();
  };
  const backFromSetup = () => {
    setSettingUp(false);
    reload();
  };

  if (settingUp) {
    return <WebPage session={session} baseURL={session.baseURL} path={SECOND_STEP_PATH} title={t("twoStep.secondStep.title")} onLeave={backFromSetup} onClose={backFromSetup} />;
  }

  const signOut = <Control look="secondary" label={t("twoStep.secondStep.signOut")} onPress={() => void onSignOut()} />;
  return (
    <GateScreen title={t("twoStep.secondStep.title")}>
      {loaded.kind === "unreachable" ? (
        <>
          <GateError message={t("mobile.secondStep.unreachable")} />
          <Control look="primary" label={t("mobile.secondStep.retry")} onPress={reload} />
        </>
      ) : loaded.kind === "setup" ? (
        <>
          <AppText>{t("twoStep.setup.intro")}</AppText>
          <AppText tone="secondary">{t("mobile.secondStep.setUpHint")}</AppText>
          <Control look="primary" label={t("mobile.secondStep.setUp")} onPress={() => setSettingUp(true)} />
        </>
      ) : loaded.kind === "factors" ? (
        <>
          {loaded.passkey ? <PasskeyStep session={session} onSettled={onSettled} /> : null}
          <CodeStep session={session} app={loaded.app} primary={!loaded.passkey} onSettled={onSettled} />
        </>
      ) : null}
      {signOut}
    </GateScreen>
  );
}

/** What a refused second step says: `invalid` in the words of the factor it was. */
function useRefusalMessage() {
  const { t, i18n } = useTranslation();
  return (refusal: Refusal, invalid: string) => {
    if (refusal.error === "locked") return t("twoStep.secondStep.locked", { time: new Intl.DateTimeFormat(i18n.language, { timeStyle: "short" }).format(refusal.retryAt) });
    return refusal.error === "invalid" ? invalid : refusal.error === "cancelled" ? t("twoStep.passkeys.cancelled") : t("twoStep.secondStep.error");
  };
}

/** « Utiliser une clé d'accès »: the system asks for the passkey (Face ID, Touch ID, a fingerprint, a security key). */
function PasskeyStep({ session, onSettled }: { session: AppSession; onSettled: (state: SessionState) => void }) {
  const { t } = useTranslation();
  const message = useRefusalMessage();
  const [working, setWorking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const use = async () => {
    if (working) return;
    setWorking(true);
    setRefusal(null);
    const outcome = await session.verifyPasskey();
    setWorking(false);
    if (outcome.ok) onSettled(outcome.session);
    else setRefusal(outcome);
  };

  return (
    <View style={{ gap: space[3] }}>
      <AppText>{t("mobile.secondStep.passkeyIntro")}</AppText>
      <Control look="primary" label={working ? t("twoStep.passkeys.waiting") : t("twoStep.passkeys.use")} onPress={() => void use()} />
      {refusal ? <GateError message={message(refusal, t("twoStep.passkeys.invalid"))} /> : null}
    </View>
  );
}

/** The code field, as the system's keyboard and autofill read it: the app's code in digits, a backup code in letters too. */
const APP_CODE_FIELD = { autoCapitalize: "none", autoCorrect: false, autoComplete: "one-time-code", textContentType: "oneTimeCode", inputMode: "numeric", returnKeyType: "done" } as const;
const BACKUP_CODE_FIELD = { ...APP_CODE_FIELD, inputMode: "text" } as const;

/** The authenticator app's code, or a backup code (the only code without an app). */
function CodeStep({ session, app, primary, onSettled }: { session: AppSession; app: boolean; primary: boolean; onSettled: (state: SessionState) => void }) {
  const { t } = useTranslation();
  const message = useRefusalMessage();
  const [backupChosen, setBackupChosen] = useState(false);
  const backup = backupChosen || !app;
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const submit = async () => {
    if (working || !code.trim()) return;
    setWorking(true);
    setRefusal(null);
    const outcome = await session.verifyCode(code);
    setWorking(false);
    if (outcome.ok) onSettled(outcome.session);
    else setRefusal(outcome);
  };

  return (
    <View style={{ gap: space[3] }}>
      <AppText>{backup ? t("twoStep.secondStep.introBackup") : t("twoStep.secondStep.intro")}</AppText>
      <GateField
        label={backup ? t("twoStep.secondStep.backupCodeLabel") : t("twoStep.secondStep.codeLabel")}
        value={code}
        onChangeText={setCode}
        onSubmitEditing={() => void submit()}
        {...(backup ? BACKUP_CODE_FIELD : APP_CODE_FIELD)}
      />
      {refusal ? <GateError message={message(refusal, t("twoStep.secondStep.invalid"))} /> : null}
      <Control look={primary ? "primary" : "secondary"} label={working ? t("twoStep.secondStep.sending") : t("twoStep.secondStep.submit")} onPress={() => void submit()} />
      {app ? (
        <Control
          label={backup ? t("twoStep.secondStep.useApp") : t("twoStep.secondStep.useBackupCode")}
          onPress={() => {
            setBackupChosen(!backup);
            setCode("");
            setRefusal(null);
          }}
        />
      ) : null}
    </View>
  );
}
