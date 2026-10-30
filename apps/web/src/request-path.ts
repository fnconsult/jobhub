/**
 * Request header naming the path and query the page was asked at, so a page sending a signed-out visitor to sign in
 * can bring them back there (#542). Set only by `src/proxy.ts`, which overwrites any value a client sent.
 */
export const REQUEST_PATH_HEADER = "x-jobhub-path";
