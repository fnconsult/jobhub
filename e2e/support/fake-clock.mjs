// E2E ONLY. Moves the server's clock to the date written in E2E_CLOCK_FILE (an ISO date, rewritten by a spec as its story
// moves forward) and keeps it ticking from there; the real clock until the file says otherwise. Ignored unless JOBHUB_TARGET=e2e.
// Used where a spec's story needs the year to be over (the DAC7 export of a closed year, #887), which the suite's real
// date cannot offer. A Stripe webhook is signed with the same clock (e2e/support/fake-clock.ts), or its timestamp would be stale.
import { readFileSync } from "node:fs";
if (process.env.JOBHUB_TARGET === "e2e") {
  const file = process.env.E2E_CLOCK_FILE;
  if (file) {
    const Real = Date;
    let offset = 0;
    const read = () => {
      try {
        const at = Real.parse(readFileSync(file, "utf8").trim());
        if (Number.isFinite(at)) offset = at - Real.now();
      } catch {
        /* no file yet: the real clock */
      }
    };
    read();
    setInterval(read, 20).unref();
    const FakeDate = new Proxy(Real, {
      construct: (target, args, newTarget) => (args.length ? Reflect.construct(target, args, newTarget) : Reflect.construct(target, [Real.now() + offset], newTarget)),
      get: (target, key, receiver) => (key === "now" ? () => Real.now() + offset : Reflect.get(target, key, receiver)),
    });
    globalThis.Date = FakeDate;
  }
}
