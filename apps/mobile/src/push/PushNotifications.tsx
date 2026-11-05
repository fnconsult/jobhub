import { BellRing, Settings } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Modal, Platform, View } from "react-native";
import { GateScreen } from "../session/GateScreen";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { PushDevice, PushPermission } from "./push-device";
import { pushLinkOf } from "./push-links";

/** Where the app asks: starting a Job Search, or adding an Interview (ADR-0076). */
export type PushContext = "jobSearch" | "interview";

/** What the provider needs of the system (device.ts): the notifications tapped, the token rotated, the device's settings. */
export interface PushSystem {
  onTapped(onTap: (response: unknown) => void): () => void;
  onTokenRotated(onRotate: () => void): () => void;
  openSettings(): void;
}

interface PushContextValue {
  permission: PushPermission | null;
  ask: (context: PushContext) => void;
  allow: () => Promise<void>;
  openSettings: () => void;
}

const PushContextOf = createContext<PushContextValue>({ permission: null, ask: () => {}, allow: async () => {}, openSettings: () => {} });

const DeviceContext = createContext<PushDevice | null>(null);

/** This device's Push notifications, for the whole app, signed in or not: sign-out forgets the device (SessionGate). */
export function PushDeviceProvider({ device, children }: { device: PushDevice; children: ReactNode }) {
  return <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;
}

/** This device's Push notifications (inside PushDeviceProvider), or null. */
export const usePushDevice = () => useContext(DeviceContext);

/** Forgets the device on the platform, as signing out does first, while its session still answers: nothing without one. */
export function useForgetPushDevice(): () => Promise<void> {
  const device = useContext(DeviceContext);
  return useCallback(async () => {
    await device?.forget();
  }, [device]);
}

/**
 * Asks for Push notifications in context (#699): where a Job Search starts or an Interview is added, the screen calls
 * `ask("jobSearch")` or `ask("interview")` once the web app has answered the write. Only a device never asked shows the
 * explanation; once allowed, refused or « Pas maintenant », nothing. Never at first launch: nothing else asks.
 * « Lancer une recherche » in Recherches d'offres asks (src/job-searches/StartJobSearch.tsx); the Interviews Section's
 * « ajouter » (#691) and any later Job Search launch or relaunch (#692) call it in the same way.
 */
export const useAskForPush = () => useContext(PushContextOf).ask;

/**
 * The signed-in app's Push notifications (#699, ADR-0076): the device registered at each start and return to the
 * foreground (and forgotten once they are turned off), again when the system rotates its token; a notification tapped
 * opens its object (`navigate`, the app's own pages only); the explanation screen, when a page asks in context.
 */
export function PushProvider({ device, system, navigate, children }: { device: PushDevice; system: PushSystem; navigate: (path: string) => void; children: ReactNode }) {
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [asking, setAsking] = useState<PushContext | null>(null);

  const refresh = useCallback(
    () =>
      device
        .sync()
        .then(() => device.permission())
        .then(setPermission),
    [device],
  );

  useEffect(() => {
    void refresh();
    const foreground = AppState.addEventListener("change", (status) => {
      if (status === "active") void refresh();
    });
    const rotated = system.onTokenRotated(() => void device.sync());
    const tapped = system.onTapped((response) => {
      const link = pushLinkOf(response);
      if (link) navigate(link);
    });
    return () => {
      foreground?.remove();
      rotated();
      tapped();
    };
  }, [device, system, navigate, refresh]);

  const value = useMemo<PushContextValue>(
    () => ({
      permission,
      ask: (context) => {
        if (permission === "notAsked") setAsking(context);
      },
      allow: async () => setPermission(await device.allow()),
      openSettings: () => system.openSettings(),
    }),
    [permission, device, system],
  );

  const answer = async (allowed: boolean) => {
    setAsking(null);
    if (allowed) {
      setPermission(await device.allow());
    } else {
      await device.decline();
      setPermission("declined");
    }
  };

  return (
    <PushContextOf.Provider value={value}>
      {children}
      {asking ? <PushExplanation context={asking} onAnswer={(allowed) => void answer(allowed)} /> : null}
    </PushContextOf.Provider>
  );
}

/** The explanation comes up from the foot, as a page of its own. */
const SLIDES_UP = "slide";

/** The screen before the system's prompt: what the notifications are for here, and that they name no one. */
function PushExplanation({ context, onAnswer }: { context: PushContext; onAnswer: (allowed: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible animationType={SLIDES_UP} onRequestClose={() => onAnswer(false)}>
      <GateScreen title={t(`mobile.push.ask.${context}.title`)}>
        <AppText>{t(`mobile.push.ask.${context}.body`)}</AppText>
        <AppText tone="secondary">{t("mobile.push.ask.privacy")}</AppText>
        <View style={{ gap: space[2] }}>
          <Control look="primary" icon={BellRing} label={t("mobile.push.ask.allow")} onPress={() => onAnswer(true)} />
          <Control look="secondary" label={t("mobile.push.ask.notNow")} onPress={() => onAnswer(false)} />
        </View>
      </GateScreen>
    </Modal>
  );
}

/**
 * Above Mon compte's Rappels in the app (#699): with notifications refused on this device, how to turn them on in its
 * settings, and the button that opens them; after « Pas maintenant », the button that asks. Nothing once allowed.
 */
export function PushSettingsNote() {
  const { t } = useTranslation();
  const { permission, allow, openSettings } = useContext(PushContextOf);
  if (permission !== "refused" && permission !== "declined") return null;
  const refused = permission === "refused";
  const os = Platform.OS === "android" ? "android" : "ios";
  return (
    <View role="note" style={{ padding: space[4], gap: space[2] }}>
      <AppText>{refused ? t(`mobile.push.settings.refused.${os}`) : t("mobile.push.settings.declined")}</AppText>
      {refused ? (
        <Control look="secondary" icon={Settings} label={t(`mobile.push.settings.openSettings.${os}`)} onPress={openSettings} />
      ) : (
        <Control look="secondary" icon={BellRing} label={t("mobile.push.ask.allow")} onPress={() => void allow()} />
      )}
    </View>
  );
}
