// The system's notifications under Jest (#699): never asked yet, no notification tapped, nothing ever arriving. The
// Push notifications' own tests give their module fakes of their own (src/push).
const actual = jest.requireActual<typeof import("expo-notifications")>("expo-notifications");

export const { IosAuthorizationStatus, AndroidImportance } = actual;

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
