/**
 * The calls a sign-in makes to its provider (#234): the token, keys and user info requests
 * Better Auth sends while it handles a provider's callback. Better Auth 1.7 has no fetch hook,
 * so, like discovery-documents.ts, the fetch in use is wrapped, and a callback's requests are
 * told apart by AsyncLocalStorage (which the handling inherits): every other request this
 * process makes goes through untouched.
 *
 *   recordingSignInCalls(request, log, () => auth.handler(request))
 *
 * Each call is recorded under the provider's sign-in Tool (TOOLS: google, apple, microsoft,
 * oidc) as what it asks for ("token", "keys", "userinfo", "discovery", "other"): never its
 * URL, the code, a token or who signed in.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { recordingFetch, type ExternalApiLog, type ExternalApiProvider } from "@jobhub/shared";

type SignInTool = Extract<ExternalApiProvider, "google" | "apple" | "microsoft" | "oidc">;

/** The social providers' callbacks, by Better Auth's id for each: the id is the Tool's. */
const SOCIAL_CALLBACK = /^\/api\/auth\/callback\/(google|apple|microsoft)$/;
/** A generic OIDC provider's callback (Better Auth's genericOAuth plugin), whatever its id. */
const OIDC_CALLBACK = /^\/api\/auth\/oauth2\/callback\/[^/]+$/;

/** The sign-in Tool the request to Better Auth at `pathname` calls: a provider's callback's; none for any other. */
export function signInToolOf(pathname: string): SignInTool | null {
  const social = SOCIAL_CALLBACK.exec(pathname)?.[1];
  if (social) return social as SignInTool;
  return OIDC_CALLBACK.test(pathname) ? "oidc" : null;
}

/** What a call to a sign-in provider asks for, from its URL's path alone. */
function operationOf(_method: string, url: URL): string {
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  if (path.includes("/.well-known/")) return "discovery";
  if (path.endsWith("/token")) return "token";
  if (path.includes("userinfo")) return "userinfo";
  if (/(\/keys|jwks[^/]*|\/certs)$/.test(path)) return "keys";
  return "other";
}

const recording = new AsyncLocalStorage<{ tool: SignInTool; log: ExternalApiLog }>();
const RECORDS = Symbol("records sign-in calls");

/** Wraps the fetch in use (again, if something replaced it since) so it records the calls made within a callback. */
function install(): void {
  const current = globalThis.fetch as typeof fetch & { [RECORDS]?: true };
  if (current[RECORDS]) return;
  const recordingWithin = Object.assign(
    (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
      const scope = recording.getStore();
      if (!scope) return current(input, init);
      return recordingFetch(current, scope.log, { provider: scope.tool, operation: operationOf })(input, init);
    },
    { [RECORDS]: true as const },
  );
  globalThis.fetch = recordingWithin as typeof fetch;
}

/** `handle`'s answer to `request`, each call it makes to a sign-in provider recorded in `log` when `request` is that provider's callback. */
export function recordingSignInCalls(request: Request, log: ExternalApiLog, handle: () => Promise<Response>): Promise<Response> {
  const tool = signInToolOf(new URL(request.url).pathname);
  if (!tool) return handle();
  install();
  return recording.run({ tool, log }, handle);
}
