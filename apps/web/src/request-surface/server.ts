import { headers } from "next/headers";
import { requestSurface, type Surface } from "./index";

/**
 * The Surface of the request being handled (#919), told from its headers as isFromTrustedOrigin reads them; null outside
 * a request (a script) or for a request that says none. Read from Next's own request scope, which it holds for the
 * whole handling, timers and streamed answers included, and never lends to another request (AsyncLocalStorage `run`):
 * where an AI call is recorded, after its own await. Never throws.
 */
export async function currentRequestSurface(): Promise<Surface | null> {
  try {
    const requestHeaders = await headers();
    // Imported here: the sign-in module records its calls through AI Usage's external APIs.
    const { getAuth } = await import("@/auth/server");
    return requestSurface(requestHeaders, new URL(String(getAuth().options.baseURL)).origin);
  } catch {
    return null;
  }
}
