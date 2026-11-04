import type { DeviceStorage, Network } from "./read-cache";

/** The device's storage, in memory: what a test reads back is what the app left on the device. */
export function memoryStorage(): DeviceStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: async (key) => entries.get(key) ?? null,
    setItem: async (key, value) => void entries.set(key, value),
    removeItem: async (key) => void entries.delete(key),
  };
}

/** A network a test turns off and on, as airplane mode would. */
export function fakeNetwork(connected = true): Network & { set: (connected: boolean) => void } {
  const listeners = new Set<(connected: boolean) => void>();
  let current = connected;
  return {
    isConnected: async () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (next) => {
      current = next;
      for (const listener of listeners) listener(next);
    },
  };
}
