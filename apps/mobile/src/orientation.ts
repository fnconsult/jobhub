import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect } from "react";
import { Dimensions, type ScaledSize } from "react-native";

/** Android's own line between a phone and a tablet: a smallest width of 600 dp (`sw600dp`). */
const TABLET_SMALLEST_WIDTH = 600;

const isPhone = (screen: Pick<ScaledSize, "width" | "height">) => Math.min(screen.width, screen.height) < TABLET_SMALLEST_WIDTH;

/**
 * Phones in portrait only, tablets in every orientation (ADR-0076). iOS reads it from the Info.plist (app.json); on
 * Android one manifest serves both, so a phone is locked here, from its screen, not its window (a tablet in split
 * screen stays a tablet), and again when a foldable opens or closes.
 */
export function usePortraitOnPhones() {
  useEffect(() => {
    const apply = (screen: ScaledSize) =>
      void (isPhone(screen) ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP) : ScreenOrientation.unlockAsync()).catch(() => {});
    apply(Dimensions.get("screen"));
    const subscription = Dimensions.addEventListener("change", ({ screen }: { screen: ScaledSize }) => apply(screen));
    return () => subscription.remove();
  }, []);
}
