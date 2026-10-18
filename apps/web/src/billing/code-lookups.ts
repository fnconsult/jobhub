/**
 * Lookups of the codes Candidates bring (`/abonnement?code=…`, then Checkout), behind the billing
 * module: each code's answer is kept a minute, so a shared link opened by many asks Stripe once,
 * and each Candidate may make only so many lookups Stripe has to answer in a window, so codes cannot
 * be found by trying one after another (nor Stripe's rate limit used up). Kept in this process's
 * memory, like the price caches: a restart forgets them, which costs a few lookups at most.
 */

export interface CodeLookupsOptions<T> {
  /** Asks Stripe what the code is (null: no code of that name can be redeemed). May throw. */
  lookup: (code: string) => Promise<T | null>;
  now: () => Date;
  /** How long an answer is kept. */
  ttlMs?: number;
  /** Lookups a requester may make Stripe answer in each window. */
  maxTries?: number;
  windowMs?: number;
}

export type CodeLookup<T> = { status: "found"; value: T | null } | { status: "throttled" };

/** The most requesters kept track of at once; the oldest are forgotten first. */
const MAX_REQUESTERS = 10_000;

export function createCodeLookups<T>({ lookup, now, ttlMs = 60_000, maxTries = 10, windowMs = 10 * 60_000 }: CodeLookupsOptions<T>) {
  const answers = new Map<string, { at: number; value: T | null }>();
  const tries = new Map<string, number[]>();

  return {
    /** The code's answer, from the cache or Stripe; `throttled` when `requester` has tried too many codes lately. */
    async find(code: string, requester: string): Promise<CodeLookup<T>> {
      const at = now().getTime();
      const cached = answers.get(code);
      if (cached && at - cached.at < ttlMs) return { status: "found", value: cached.value };
      const recent = (tries.get(requester) ?? []).filter((time) => at - time < windowMs);
      if (recent.length >= maxTries) {
        tries.set(requester, recent);
        return { status: "throttled" };
      }
      tries.delete(requester);
      tries.set(requester, [...recent, at]);
      if (tries.size > MAX_REQUESTERS) tries.delete(tries.keys().next().value!);
      const value = await lookup(code);
      answers.set(code, { at, value });
      if (answers.size > MAX_REQUESTERS) answers.delete(answers.keys().next().value!);
      return { status: "found", value };
    },
    /** Forgets every kept answer: a code was created or deactivated. */
    forget(): void {
      answers.clear();
    },
  };
}
