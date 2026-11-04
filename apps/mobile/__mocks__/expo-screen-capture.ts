// What the app switcher shows of the app, and whether screenshots are refused (src/testing-device.ts).
import { fakeDevice } from "../src/testing-device";

const protect = (on: boolean) => async () => void (fakeDevice.contentProtected = on);

export const enableAppSwitcherProtectionAsync = protect(true);
export const disableAppSwitcherProtectionAsync = protect(false);
export const preventScreenCaptureAsync = protect(true);
export const allowScreenCaptureAsync = protect(false);
