// The Keychain or Keystore, in memory (src/testing-device.ts).
import { fakeDevice } from "../src/testing-device";

const actual = jest.requireActual<typeof import("expo-secure-store")>("expo-secure-store");

export const { AFTER_FIRST_UNLOCK, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, WHEN_UNLOCKED, WHEN_UNLOCKED_THIS_DEVICE_ONLY } = actual;
export const getItem = (key: string) => fakeDevice.keychain.get(key) ?? null;
export const getItemAsync = async (key: string) => getItem(key);
export const setItemAsync = async (key: string, value: string) => void fakeDevice.keychain.set(key, value);
export const deleteItemAsync = async (key: string) => void fakeDevice.keychain.delete(key);
