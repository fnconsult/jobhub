import AsyncStorage from "@react-native-async-storage/async-storage";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import type { DeviceStorage, Network } from "./read-cache";

/**
 * The device's own storage for the read cache: AsyncStorage, which is not encrypted, so it holds the reads alone; the
 * session stays in the Keychain or the Keystore (ADR-0076).
 */
export const deviceStorage: DeviceStorage = AsyncStorage;

/** A state the system has not settled yet counts as connected: a read or a write that then fails says so as any does. */
const connected = (state: { isConnected?: boolean }) => state.isConnected !== false;

/** The device's network as expo-network reports it (TanStack Query's React Native recipe). */
export const deviceNetwork: Network = {
  isConnected: async () => connected(await getNetworkStateAsync()),
  subscribe: (onChange) => {
    const subscription = addNetworkStateListener((state) => onChange(connected(state)));
    return () => subscription.remove();
  },
};
