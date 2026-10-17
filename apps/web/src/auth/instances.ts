/**
 * The sign-in instance in use, by configuration version. The first is used at once; a
 * rebuilt one (a Sign-in Provider changed) replaces it only once it has started (Better
 * Auth's start fetches each OIDC issuer's discovery document): until then, requests keep
 * the one in use, so an issuer slow to answer stalls no request.
 */
export function swapWhenReady<T>(
  ready: (built: T) => Promise<unknown>,
  options: { log?: (line: string) => void } = {},
): {
  /** The instance to serve a request with, building the one of `version` with `build` if it is not built yet. */
  get(version: string, build: () => T): T;
  /** Waits, up to `timeoutMs`, for the instance of `version` to be the one in use: after a change made in this process. */
  settled(version: string, timeoutMs: number): Promise<void>;
} {
  const log = options.log ?? ((line: string) => console.warn(line));
  let current: { version: string; value: T } | null = null;
  let pending: { version: string; value: T; started: Promise<void> } | null = null;

  return {
    get(version, build) {
      if (!current) {
        current = { version, value: build() };
        return current.value;
      }
      if (current.version !== version && pending?.version !== version) {
        const value = build();
        const next: { version: string; value: T; started: Promise<void> } = {
          version,
          value,
          started: ready(value).then(
            () => undefined,
            (error: unknown) => log(`[sign-in] the rebuilt sign-in started with an error, used anyway: ${error instanceof Error ? error.message : String(error)}`),
          ),
        };
        pending = next;
        void next.started.then(() => {
          // A newer one may have been asked for meanwhile: that one replaces this.
          if (pending !== next) return;
          current = { version: next.version, value: next.value };
          pending = null;
        });
      }
      return current.value;
    },

    async settled(version, timeoutMs) {
      if (current?.version === version || pending?.version !== version) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([pending.started.then(() => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
      clearTimeout(timer);
      // Let the swap queued on `started` run first.
      await Promise.resolve();
    },
  };
}
