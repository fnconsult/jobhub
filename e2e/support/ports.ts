import { createRequire } from "node:module";

// `next start -p` refuses the ports browsers block (https://fetch.spec.whatwg.org/#port-blocking),
// e.g. 3659: "Bad port: "3659" is reserved for apple-sasl". Ports the suite derives from
// E2E_WEB_PORT can land on one of them, so they skip ahead to the next allowed port,
// using Next.js' own list so the two never disagree.
const { isPortIsReserved, getReservedPortExplanation } = createRequire(import.meta.url)(
  "next/dist/lib/helpers/get-reserved-port.js",
) as { isPortIsReserved: (port: number) => boolean; getReservedPortExplanation: (port: number) => string };

/** E2E_WEB_PORT, refused up front when Next.js would refuse it (the suite would fail with no hint why). */
export function webPort(): number {
  const port = Number(process.env.E2E_WEB_PORT ?? 3001);
  if (isPortIsReserved(port)) {
    throw new Error(`E2E_WEB_PORT=${port} cannot be used: ${getReservedPortExplanation(port)}\nPick another E2E_WEB_PORT.`);
  }
  return port;
}

/** E2E_WEB_PORT + `offset`, moved past any port Next.js and browsers refuse. */
export function derivedPort(offset: number): number {
  let port = webPort() + offset;
  while (isPortIsReserved(port)) port += 1;
  return port;
}
