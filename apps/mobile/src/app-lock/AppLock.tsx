import { Lock } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AppState, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { askDeviceOwner, deviceCanLock, type DeviceOwner, lockSettingIsOn, protectContent, saveLockSetting } from "./device";
import { locksOnReturn } from "./lock-timing";

/** What turning the lock on came to: on, refused at the prompt, or impossible on a device with no Face ID, fingerprint or code. */
export type TurnOn = "on" | "refused" | "unavailable";

type AppLockSetting = { on: boolean; turnOn: () => Promise<TurnOn>; turnOff: () => Promise<void> };

const AppLockContext = createContext<AppLockSetting | null>(null);

/** « Verrouiller l'app », for the app's settings: on or off, a setting of this device and never of the account. */
export function useAppLock(): AppLockSetting {
  const setting = useContext(AppLockContext);
  if (!setting) throw new Error("useAppLock outside <AppLock>");
  return setting;
}

/**
 * The optional lock by Face ID or fingerprint (ADR-0076), around the whole app. Off by default. On, the app is locked
 * when it starts and when it comes back after 5 minutes or more in the background; the system's prompt opens at once,
 * the device's code as its fallback, and « Déverrouiller » asks again. While the lock is on, the app switcher shows no
 * content. A lock of the device, not a second step: the session and Two-step verification are untouched (ADR-0075).
 */
export function AppLock({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(lockSettingIsOn);
  const [locked, setLocked] = useState(on);
  const leftAt = useRef<number | null>(null);
  const asking = useRef(false);

  const prompt = useMemo(() => ({ cancelLabel: t("mobile.appLock.cancel") }), [t]);

  /** The system's prompt, once at a time; a second ask while it is open gets `null`. */
  const ask = useCallback(async (promptMessage: string) => {
    if (asking.current) return null;
    asking.current = true;
    try {
      return await askDeviceOwner({ ...prompt, promptMessage });
    } finally {
      asking.current = false;
    }
  }, [prompt]);

  const settle = useCallback((owner: DeviceOwner | null) => {
    if (owner === null || owner === "refused") return;
    // Face ID, fingerprint and code all removed from the device: nothing could unlock, so the lock goes off with them.
    if (owner === "unavailable") {
      void saveLockSetting(false);
      setOn(false);
    }
    setLocked(false);
  }, []);

  const unlock = useCallback(() => void ask(t("mobile.appLock.unlockPrompt")).then(settle), [ask, settle, t]);

  // The prompt opens by itself as the lock engages; after that, « Déverrouiller » asks again.
  useEffect(() => {
    if (locked) unlock();
  }, [locked, unlock]);

  useEffect(() => {
    void protectContent(on);
  }, [on]);

  useEffect(() => {
    if (!on) return;
    const subscription = AppState.addEventListener("change", (state) => {
      // `inactive` alone is not leaving: the system's own prompt, Control Centre or a call make the app inactive.
      if (state === "background" && !locked && leftAt.current === null) leftAt.current = Date.now();
      if (state === "active" && leftAt.current !== null) {
        if (locksOnReturn(leftAt.current, Date.now())) setLocked(true);
        leftAt.current = null;
      }
    });
    return () => subscription.remove();
  }, [on, locked]);

  const setting = useMemo<AppLockSetting>(
    () => ({
      on,
      turnOn: async () => {
        if (!(await deviceCanLock())) return "unavailable";
        if ((await ask(t("mobile.appLock.turnOnPrompt"))) !== "recognised") return "refused";
        await saveLockSetting(true);
        setOn(true);
        return "on";
      },
      turnOff: async () => {
        await saveLockSetting(false);
        setOn(false);
      },
    }),
    [on, ask, t],
  );

  return (
    <AppLockContext.Provider value={setting}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }} aria-hidden={locked}>
          {children}
        </View>
        {locked ? <LockScreen onUnlock={unlock} /> : null}
      </View>
    </AppLockContext.Provider>
  );
}

/** Over the whole app while it is locked: opaque, so no page shows through, and the one way back in. */
function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      aria-modal
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: space[4],
        padding: space[4],
        paddingTop: insets.top + space[4],
        paddingBottom: insets.bottom + space[4],
        backgroundColor: colors.background,
      }}
    >
      <Lock color={colors.secondary} size={32} aria-hidden />
      <AppText variant="h2" centered>
        {t("mobile.appLock.locked")}
      </AppText>
      <Control look="primary" label={t("mobile.appLock.unlock")} onPress={onUnlock} />
    </View>
  );
}
