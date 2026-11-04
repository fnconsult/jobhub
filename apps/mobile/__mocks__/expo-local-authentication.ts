// The system's Face ID, fingerprint or device code prompt, answered as the test says (src/testing-device.ts).
import type { LocalAuthenticationOptions } from "expo-local-authentication";
import { fakeDevice } from "../src/testing-device";

const actual = jest.requireActual<typeof import("expo-local-authentication")>("expo-local-authentication");

export const { SecurityLevel, AuthenticationType } = actual;
export const getEnrolledLevelAsync = async () => fakeDevice.enrolledLevel;
export const authenticateAsync = (options?: LocalAuthenticationOptions) => fakeDevice.authenticate(options);
