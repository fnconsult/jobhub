/** How long the app may stay in the background before it locks (ADR-0076). */
export const LOCK_AFTER_MS = 5 * 60_000;

/**
 * Whether the app, back in the foreground at `now` after leaving it at `leftAt` (both `Date.now()`), locks: from 5 minutes
 * away, and also when the clock went backwards meanwhile, since a clock put back must not hold the lock off.
 */
export const locksOnReturn = (leftAt: number, now: number) => now - leftAt >= LOCK_AFTER_MS || now < leftAt;
