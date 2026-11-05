# Issue #701: offline read cache with TanStack Query persistence (Expo)

Scope: only the third-party facts needed for the persisted read cache, the « Hors ligne » banner and clearing on sign-out. Sources are the official TanStack Query and Expo docs (main branch), fetched 2026-11-04. Pinned package versions were not checked: confirm against the lockfile.

## Persisting the cache
Sources: TanStack `docs/framework/react/plugins/persistQueryClient.md`, `createAsyncStoragePersister.md`
- Use `PersistQueryClientProvider` (`@tanstack/react-query-persist-client`) instead of `QueryClientProvider`; queries do not fetch until restore is done (`useIsRestoring` exposes it). `onSuccess` fires after restore.
- Persister: `createAsyncStoragePersister({ storage: AsyncStorage, key?, throttleTime? })` from `@tanstack/query-async-storage-persister`, with `@react-native-async-storage/async-storage`.
- `gcTime` on the `QueryClient` MUST be >= `maxAge`, otherwise garbage collection discards the stored cache early. `maxAge` defaults to 24 h. The maximum `gcTime` is about 24 days (JS `setTimeout` limit).
- `buster` string: a cache stored under a different buster is discarded. Use it to invalidate on app or schema change.
- A restored cache that is expired, busted, errors or is empty is discarded and `persister.removeClient()` is called.
- `dehydrateOptions.shouldDehydrate` selects which queries are persisted (signature not re-verified here; read the Dehydrate reference before using). This is the lever to keep Coach Conversations out of the persisted store (criterion 3).

## Clearing on sign-out
Sources: same persistQueryClient page
- The docs offer no dedicated « clear » function. Documented mechanisms: the persister's `removeClient()` (part of the Persister interface: `persistClient`, `restoreClient`, `removeClient`), and a new `buster` passed to restore, which triggers `removeClient`.
- Implication: on sign-out call `queryClient.clear()` AND `persister.removeClient()` (await it), and stop persisting before the clear so a throttled write does not re-save. The throttled save (`throttleTime`) is a race to cover in the test « déconnexion vide le cache ».
- UNVERIFIED: whether `queryClient.clear()` alone triggers a persisted write of the empty cache.

## Online state and silent refresh
Sources: TanStack `react-native.md`, `guides/network-mode.md`; Expo `sdk/network.mdx`
- React Native has no browser online/offline events: wire `onlineManager.setEventListener`. The docs give an `expo-network` recipe (`Network.addNetworkStateListener` + `getNetworkStateAsync`, `setOnline(!!state.isConnected)`), and a `@react-native-community/netinfo` one. The Expo recipe fits ADR-0076 (Expo).
- `isConnected` means a network connection, not proven internet reachability; a captive portal or dead Wi-Fi reads as online. Not stated on the fetched page in these words: treat as UNVERIFIED and let failed fetches show the banner too.
- Default `networkMode: 'online'`: with no connection, queries are `fetchStatus: 'paused'` and resume automatically on reconnect (`refetchOnReconnect` defaults to true). A first-mount query without cache stays `pending` + `paused`: the UI must test `fetchStatus`, not only `pending`, to avoid an endless spinner.
- Silent refresh on return of network = the defaults with `onlineManager` wired. Foreground refetch needs `focusManager` plus `AppState` (same page).
- Read with `useIsOnline`-style logic via `onlineManager.isOnline()` / `useSyncExternalStore` for the banner (hook not documented on the fetched page).

## Writes offline
- Mutations are also paused when offline under the default mode and would replay on reconnect (`resumePausedMutations`, mentioned for `onSuccess`). The issue says nothing is written offline: do not persist mutations (default `shouldDehydrate` includes only queries unless configured, UNVERIFIED), and refuse writes in app code by checking online state before calling, with a readable reason.

## Where the cache lives (privacy register)
Source: Expo `sdk/securestore.mdx`
- AsyncStorage is not encrypted. `expo-secure-store` (Keychain/Keystore) is for secrets; some iOS releases historically rejected values above about 2048 bytes and Expo enforces no limit: unsuited to a whole query cache. The session stays in SecureStore via `@better-auth/expo` (ADR-0076).
- Android Auto Backup: `expo-secure-store` entries are excluded from backup automatically when no custom backup config exists. AsyncStorage content is NOT covered by this page: whether the cache is included in device backups (iCloud, Android Auto Backup) was not verified; check the platform docs before writing the register line « données en cache sur l'appareil ».

## Open points for the implementer
1. Choose `shouldDehydrate` allow-list: menus cards, Applications, Agenda, Job Offers only.
2. Set `maxAge` (default 24 h; decide a value) and `gcTime >= maxAge`.
3. Verify backup inclusion of AsyncStorage on iOS and Android.
