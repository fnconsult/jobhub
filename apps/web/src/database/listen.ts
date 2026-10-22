import type { Notification, Pool, PoolClient } from "pg";

/**
 * Calls `onChange` whenever something is announced on Postgres channel `channel` (NOTIFY):
 * a Provider Secret replaced or cleared, a Sign-in Provider changed.
 * Listens on one connection taken from `database` for good, so the process stays
 * within its pool's budget of connections. Never gives up: when listening cannot start
 * or the connection drops, it tries again, waiting `reconnectMs` and doubling up to
 * `maxReconnectMs`, and calls `onChange` once listening again (a change may have been
 * missed). Returns a function that stops.
 */
export async function listenForNotifications(
  database: Pick<Pool, "connect">,
  channel: string,
  onChange: () => void,
  options: { log?: (line: string) => void; /** Names the listener in what is logged. Default: "provider-secrets". */ label?: string; reconnectMs?: number; maxReconnectMs?: number } = {},
): Promise<() => Promise<void>> {
  if (!/^[a-z_]+$/.test(channel)) throw new Error(`Not a channel name: ${channel}`);
  const log = options.log ?? ((line: string) => console.warn(line));
  const label = options.label ?? "provider-secrets";
  const firstDelay = options.reconnectMs ?? 1_000;
  const maxDelay = options.maxReconnectMs ?? 60_000;
  let delay = firstDelay;
  let client: { connection: PoolClient; detach(): void } | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const onNotification = (message: Notification) => {
    if (message.channel === channel) onChange();
  };

  function again(): void {
    if (stopped) return;
    retry = setTimeout(() => void listen(true), delay);
    retry.unref?.();
    delay = Math.min(delay * 2, maxDelay);
  }

  /** One attempt; `missed`: a change may have gone unheard since the last one. */
  async function listen(missed: boolean): Promise<void> {
    let listening: PoolClient;
    try {
      listening = await database.connect();
    } catch (error) {
      log(`[${label}] cannot listen for changes, trying again in ${delay} ms: ${error instanceof Error ? error.message : String(error)}`);
      return again();
    }
    const detach = () => {
      listening.off("notification", onNotification);
      listening.off("error", dropped);
    };
    const dropped = (error: Error) => {
      log(`[${label}] stopped listening for changes, trying again in ${delay} ms: ${error.message}`);
      detach();
      if (client?.connection === listening) client = null;
      listening.release(error);
      again();
    };
    listening.on("notification", onNotification);
    listening.on("error", dropped);
    try {
      await listening.query(`LISTEN ${channel}`);
    } catch (error) {
      return dropped(error instanceof Error ? error : new Error(String(error)));
    }
    if (stopped) {
      detach();
      listening.release();
      return;
    }
    client = { connection: listening, detach };
    delay = firstDelay;
    if (missed) onChange();
  }

  await listen(false);
  return async () => {
    stopped = true;
    clearTimeout(retry);
    const listening = client;
    client = null;
    if (!listening) return;
    listening.detach();
    await listening.connection.query(`UNLISTEN ${channel}`).catch(() => {});
    listening.connection.release();
  };
}
