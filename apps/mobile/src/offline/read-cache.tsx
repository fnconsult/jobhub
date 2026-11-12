import { API_VERSION } from "@jobhub/shared";
import { defaultShouldDehydrateQuery, MutationCache, onlineManager, QueryClient, type QueryKey } from "@tanstack/react-query";
import { PersistQueryClientProvider, type PersistedClient, type Persister } from "@tanstack/react-query-persist-client";
import { createContext, Fragment, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

/** Where the app keeps things on the device: AsyncStorage in the app, memory in a test. */
export type DeviceStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/** Whether the device has a network: expo-network in the app, a switch in a test. */
export type Network = { isConnected: () => Promise<boolean>; subscribe: (onChange: (connected: boolean) => void) => () => void };

/**
 * The app's reads (`@jobhub/shared/reads`, ADR-0076), each with whether the device keeps what was last seen of it for
 * when there is no network (#701): the menus' cards, an Application and its Company Dossier, the Agenda and the Job
 * Offers seen (a Job Search's, a Job Digest's, an Offer box entry's opened, each with why it has its Match Score: the Profile's wanted places, salary
 * and contract types, the CV's years and skills; docs/privacy/register.md, « Read cache in the Jobbbox app »). Never a
 * Coach Conversation, nor a Profile read, a Tailored Document's download links or an Application's Enriched Contacts
 * (#691: third parties' details).
 */
const READS = {
  applications: true,
  application: true,
  agenda: true,
  jobSearches: true,
  jobSearch: true,
  offerBox: true,
  offerBoxOffer: true,
  offerBoxEntryOf: false,
  offersToHandle: false,
  jobOffer: true,
  jobDigests: true,
  jobDigest: true,
  humanCoaches: true,
  companyDossier: true,
  profiles: false,
  profile: false,
  tailoredDocuments: false,
  enrichedContacts: false,
  coachConversations: false,
  coachConversation: false,
} as const satisfies Record<string, boolean>;

export type ReadName = keyof typeof READS;

/** A read's query key: its name, then what names the object read (an id, a period). */
export const readKey = (name: ReadName, ...params: string[]): QueryKey => [name, ...params];

const keptOnDevice = (queryKey: QueryKey) => READS[queryKey[0] as ReadName] === true;

/** What was last seen stays a week on the device; a longer absence reads everything afresh. */
const KEPT_FOR_MS = 7 * 24 * 60 * 60 * 1000;
/** The cache is written at most this often while it changes. */
const SAVE_EVERY_MS = 1000;
const STORAGE_KEY = "jobbbox.reads";
/** A cache saved by an app speaking another API Version, or under another shape of this one, is not restored. */
const BUSTER = `api-${API_VERSION}.cache-1`;

/**
 * The device's copy of the read cache: written at most every SAVE_EVERY_MS, one write at a time, and `forget` drops a
 * write still waiting before it removes the copy, so nothing read before it lands after it. A restoring still under way
 * when it forgets gives nothing back (#756): the copy it had read belongs to the session that ended.
 */
function devicePersister(storage: DeviceStorage): Persister & { forget: () => Promise<void> } {
  /** How many times the cache was forgotten: a restoring started before the last one gives nothing back. */
  let forgotten = 0;
  let waiting: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const queue = (write: () => Promise<void>) => (writes = writes.then(write, write));
  return {
    persistClient: (client) => {
      waiting = client;
      timer ??= setTimeout(() => {
        timer = null;
        const client = waiting;
        waiting = null;
        if (!client) return;
        // A cache with nothing to keep leaves nothing on the device, not an empty copy.
        void queue(() => (client.clientState.queries.length ? storage.setItem(STORAGE_KEY, JSON.stringify(client)) : storage.removeItem(STORAGE_KEY)));
      }, SAVE_EVERY_MS);
    },
    restoreClient: async () => {
      const asked = forgotten;
      const saved = await storage.getItem(STORAGE_KEY);
      return saved && asked === forgotten ? (JSON.parse(saved) as PersistedClient) : undefined;
    },
    removeClient: () => queue(() => storage.removeItem(STORAGE_KEY)),
    forget: () => {
      forgotten += 1;
      if (timer) clearTimeout(timer);
      timer = null;
      waiting = null;
      return queue(() => storage.removeItem(STORAGE_KEY));
    },
  };
}

/** TanStack Query's online state follows the device's network (React Native has no browser events for it). */
function useNetworkFollowed(network: Network) {
  useEffect(() => {
    onlineManager.setEventListener((setOnline) => {
      void network.isConnected().then(setOnline);
      return network.subscribe(setOnline);
    });
  }, [network]);
}

/**
 * Whether the device has a network, as the reads see it: without one they show what was last seen, and every write is
 * refused (« Hors ligne »). A network that does not reach the internet (a captive portal) still counts as one.
 */
export const useOnline = () => useSyncExternalStore(onlineManager.subscribe.bind(onlineManager), () => onlineManager.isOnline());

/** Why a write failed: there was no network, so it was not sent, and will not be later (#701). */
class RefusedOffline extends Error {
  constructor() {
    super("refused_offline");
    this.name = "RefusedOffline";
  }
}

/** Whether a write's error is its refusal for want of network: nothing was sent. */
export const isRefusedOffline = (error: unknown) => error instanceof RefusedOffline;

/**
 * Nothing is written offline (ADR-0076): a write asked without network fails at once rather than waiting to be sent
 * later, when the person may no longer mean it; one whose network drops on the way fails as any request does.
 */
function readCacheClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onMutate: () => {
        if (!onlineManager.isOnline()) throw new RefusedOffline();
      },
    }),
    defaultOptions: { queries: { gcTime: KEPT_FOR_MS }, mutations: { networkMode: "always" } },
  });
}

/** `restart`: the screens below the provider start again, empty (the default); false when none is shown, at a session's end. */
type ForgetReads = (options?: { restart?: boolean }) => Promise<void>;

const ForgetContext = createContext<ForgetReads>(async () => {});

/**
 * The app's reads, cached (TanStack Query) and kept on the device for when there is no network (ADR-0076, #701): what
 * READS keeps, a week at most, and never a write. Queries use `readKey`.
 */
export function ReadCacheProvider({ device, children }: { device: { storage: DeviceStorage; network: Network }; children: ReactNode }) {
  const [cache] = useState(() => ({
    client: readCacheClient(),
    persister: devicePersister(device.storage),
  }));
  // Every screen starts again after a sign-out, so none still shows what the cache held.
  const [session, setSession] = useState(0);
  const forget = useCallback<ForgetReads>(
    async ({ restart = true } = {}) => {
      await cache.client.cancelQueries();
      cache.client.clear();
      await cache.persister.forget();
      if (restart) setSession((current) => current + 1);
    },
    [cache],
  );
  useNetworkFollowed(device.network);
  return (
    <PersistQueryClientProvider
      client={cache.client}
      persistOptions={{
        persister: cache.persister,
        maxAge: KEPT_FOR_MS,
        buster: BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) && keptOnDevice(query.queryKey), shouldDehydrateMutation: () => false },
      }}
    >
      <ForgetContext.Provider value={forget}>
        <Fragment key={session}>{children}</Fragment>
      </ForgetContext.Provider>
    </PersistQueryClientProvider>
  );
}

/**
 * Empties the read cache, in the app and on the device, a write still waiting included; to await whenever a session
 * ends (#685, #695: SessionGate). The screens below the provider start again, empty, unless `restart` is false.
 */
export const useForgetReads = () => useContext(ForgetContext);
