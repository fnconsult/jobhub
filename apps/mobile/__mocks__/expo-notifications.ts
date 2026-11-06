// The system's notifications under Jest (#699): never asked yet, no notification tapped, nothing ever arriving. The
// Push notifications' own tests give their module fakes of their own (src/push). The two enums are copied as values
// rather than loaded from the real module, whose import starts its native listeners and slows every suite that mounts the app.
export const IosAuthorizationStatus = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 } as const;
export const AndroidImportance = { UNKNOWN: 0, UNSPECIFIED: 1, NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 } as const;

const UNDETERMINED = { status: "undetermined", granted: false, canAskAgain: true, expires: "never" };
const nothing = () => ({ remove: () => {} });

export const getPermissionsAsync = async () => UNDETERMINED;
export const requestPermissionsAsync = async () => UNDETERMINED;
export const getDevicePushTokenAsync = async () => ({ type: "ios", data: "test-device-token" });
export const setNotificationChannelAsync = async () => null;
export const setNotificationHandler = () => {};
export const getLastNotificationResponse = () => null;
export const clearLastNotificationResponse = () => {};
export const addNotificationResponseReceivedListener = nothing;
export const addPushTokenListener = nothing;
