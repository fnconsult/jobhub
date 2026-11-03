// Stopping a server a spec started in its own process group (`spawn(..., { detached: true })`): the whole group, and
// only once none of it is left (#673).
//
// `next dev` persists Turbopack's cache (apps/web/.next/dev/cache) as it stops, and every `next dev` of the suite reads
// that same cache as it starts. Killed while writing it, the server leaves a torn cache, and the next `next dev` serves
// 404 for routes it has: from its first request (`/api/health` never answers), or later (the magic-link request).
// So: SIGTERM, then wait for the group to be gone before the next server starts. NEXT_EXIT_TIMEOUT_MS, set in
// playwright.config.ts, lets `next dev` give its server that time instead of SIGKILLing it after 100 ms.

/** Long enough for `next dev` to write its cache on a loaded CI runner; what is left after it is killed. */
export const GROUP_EXIT_TIMEOUT_MS = 60_000;

/** Whether any process of the group `pgid` is still alive. */
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits up to `ms` for the group `pgid` to be gone; whether it is. */
export async function groupGone(pgid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (groupAlive(pgid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/**
 * SIGTERM to the group `pgid`, and back once none of it is left. A group still there after `ms` is killed: a server
 * that hangs as it stops must not hold its port, or its lock in apps/web/.next/dev, for the next test.
 */
export async function stopGroup(pgid: number | undefined, ms = GROUP_EXIT_TIMEOUT_MS): Promise<void> {
  if (!pgid || !groupAlive(pgid)) return;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    return;
  }
  if (await groupGone(pgid, ms)) return;
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    return;
  }
  await groupGone(pgid, 10_000);
}
