# Research for #534: Next.js error surfaces for Jobbbox

Checked 2026-10-30 against the installed version only: `next` **16.3.8** (`apps/web/package.json` `^16.3.8`, `package-lock.json` resolves 16.3.8). Next 16 ships its docs in the package (`node_modules/next/dist/docs/`); every doc claim below was read there and matches the nextjs.org page linked. Source claims were read in the compiled `node_modules/next/dist/` of 16.3.8 (same code as `packages/next/src/` at tag [`v16.3.8`](https://github.com/vercel/next.js/tree/v16.3.8/packages/next/src)). Nothing was run (no install, build or server); points marked **verify** need a test on a build.

Jobbbox facts that shape the answers: one root layout (`app/layout.tsx`, which reads the locale and the session); no `loading.tsx` and no `<Suspense>` anywhere in `app/`, so pages do not stream and the HTTP status Next sets is the one sent; the Back Office has no `app/admin/layout.tsx` (each page renders `BackOfficeLayout` itself) and `requireBackOffice()` answers `notFound()` to non-Administrators on purpose (`admin/server.ts`).

## 1. `error.tsx` per segment vs `global-error.tsx`

Sources: [error.js](https://nextjs.org/docs/app/api-reference/file-conventions/error), [Error handling](https://nextjs.org/docs/app/getting-started/error-handling), [catchError](https://nextjs.org/docs/app/api-reference/functions/catchError).

- Both are Client Components and receive `error: Error & { digest?: string }` and **`retry()`** (stable since 16.3.0; `unstable_retry` in 16.2). `reset()` still exists but only clears state without re-fetching; the docs say to prefer `retry()`. Our `global-error.tsx` uses `reset()`: switch to `retry()`.
- In production, a Server Component error reaches the client with a generic `message` and the `digest`, which matches the server log. Client Component errors keep their message. So the digest is the only thing safe to show and copy (map decision: digest shown + "Signaler un problème").
- `error.tsx` wraps its segment's `page`, `not-found`, `loading` and nested layouts, **not the layout of its own segment**; that layout stays rendered. Errors bubble to the nearest parent boundary. `global-error.tsx` replaces the root layout, must render its own `<html>`/`<body>`, gets none of the root layout's CSS, theme or providers, and cannot export `metadata` (use a React `<title>`).
- `catchError()` (new in 16.x) builds the same boundary for any component, not tied to a route segment.
- Language in `global-error`: it runs when the root layout itself failed, so `getRequestLocale()` / the session may be what broke, and as a Client Component it cannot call `headers()`. Options: (a) render both languages (FR first, EN under it); (b) on the client, pick from `navigator.language`/a cookie in an effect after hydration (flashes); (c) a locale cookie set at sign-in / language change, read with `document.cookie` (still client-only, SSR shows the default).

**Recommendation.** One `error.tsx` per shell, placed where the shell is the layout *above* it, so the shell stays: Candidate sections already have layouts (`compte/(sections)`, `profils/[id]/(sections)`, `candidatures/[id]`); give the Back Office an `app/admin/layout.tsx` (or a route group) if its 500 must keep the Compact shell, since today the shell is inside each page and a page error takes it down. Use `retry()`, show `error.digest`, and keep `global-error.tsx` neutral and **bilingual (option a)**: no dependency on what failed, and it matches "FR and EN, FR is authoritative".

## 2. `not-found.tsx` per segment or route group

Sources: [not-found.js](https://nextjs.org/docs/app/api-reference/file-conventions/not-found), [notFound](https://nextjs.org/docs/app/api-reference/functions/not-found).

- `notFound()` renders the **nearest** `not-found.tsx` up the tree from where it is thrown, inside the layouts above it. So `app/admin/not-found.tsx` handles every `notFound()` thrown under `/admin/...`.
- Unmatched URLs are handled only by the **root** `app/not-found.tsx` (or the experimental `global-not-found.tsx`): the docs say the root file handles "any unmatched URLs for your whole application". `/admin/does-not-exist` therefore gets the public 404 unless a catch-all `app/admin/[...missing]/page.tsx` calls `notFound()` (common pattern, **verify**).
- `not-found.tsx` takes no props but may be an async Server Component (can call `headers()`, `getServerT()`, the session), as ours already does.
- Caveat specific to Jobbbox: `requireBackOffice()` answers 404 to signed-in non-Administrators to hide the Back Office. An `admin/not-found.tsx` that always draws the Back Office shell would undo that. It must draw the shell only when the viewer is an Administrator (`backOfficeStanding()` is `signed_in`), and the public 404 otherwise. It cannot call `requireBackOffice()` (that throws `notFound()` again).
- `global-not-found.tsx` (`experimental.globalNotFound`) is meant for apps with several root layouts; we have one: not needed.

**Recommendation.** Root `not-found.tsx` = public-site shell (Visitor/Guest) or Candidate shell if signed in; `app/admin/not-found.tsx` = Back Office shell for Administrators only, public 404 otherwise; same for `espace-coach/`. Add `admin/[...missing]/page.tsx` (and `espace-coach/[...missing]`) only if unknown URLs there should get the role shell.

## 3. `forbidden()` / `unauthorized()` (`authInterrupts`)

Sources: [forbidden](https://nextjs.org/docs/app/api-reference/functions/forbidden), [forbidden.js](https://nextjs.org/docs/app/api-reference/file-conventions/forbidden), [unauthorized.js](https://nextjs.org/docs/app/api-reference/file-conventions/unauthorized), [authInterrupts](https://nextjs.org/docs/app/api-reference/config/next-config-js/authInterrupts).

- Status in 16.3.8: still **experimental** (doc front-matter `version: experimental`; behind `experimental.authInterrupts`, default `false` in `server/config-shared.js`). Introduced in 15.1, unchanged since.
- `forbidden()` sends **403**, `unauthorized()` **401** (`client/components/http-access-fallback/http-access-fallback.js`: `FORBIDDEN: 403, UNAUTHORIZED: 401`), render the nearest `forbidden.tsx` / `unauthorized.tsx`, add `<meta name="robots" content="noindex">`, work in Server Components, Server Functions and Route Handlers, and cannot be called in the root layout. Without the flag, `create-component-tree.js` ignores those files.
- Alternative without the flag: a `ForbiddenPage` component rendered by the page itself (`return <ForbiddenPage />`). It cannot set a 403 status (an App Router page has no way to set its status other than these interrupts), so the response would be 200 with an explicit `noindex`.

**Recommendation.** Enable `experimental.authInterrupts` and use `forbidden()` + `forbidden.tsx` per shell for the 403 page: it is small, already in Next since 15.1, and is the only way to get a real 403. Keep it out of `requireBackOffice()` for non-Administrators (they keep the hiding 404); use it for an Administrator lacking a role's permission only if product wants to say "you lack access" there (today it is a 404 and recorded in the Journal). Do not use `unauthorized()`: 401 stays a redirect to `/connexion` (map decision).

## 4. Maintenance 503 from `proxy.ts`

Sources: [proxy.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) (Producing a response, Runtime, Execution order); source `server/lib/router-utils/resolve-routes.js`, `server/lib/router-server.js`, `server/base-server.js`.

- Proxy runs on the **Node.js runtime** by default in 16 (the `runtime` option is not allowed), so it can import server code. It can **return a `Response` directly** with any status and headers.
- `NextResponse.rewrite(url, { status: 503 })` is **not** a reliable way to get a 503: the docs never give rewrite a status, and in the source the proxy's status is copied to `res.statusCode` but the page render then sets it again (`base-server.js` sets `res.statusCode = 200` before running the route; `router-server.js` uses `statusCode || 200`). Expect a 200 (**verify** if we ever want it).
- Without a database query per request: the Back Office switch lives in Platform Settings, which are already a per-process cache (`platform-settings/server.ts`: one `globalThis` copy per process, filled at start by `instrumentation.ts`, refreshed on Postgres `NOTIFY` and every 60 s). `getPlatformSettingsResolver().current()` is synchronous and never touches the database. Since proxy runs in the same Node process (**verify** that the `globalThis` holder is shared with the proxy bundle; it is designed for exactly that across chunks), proxy can read it for free. Env alone would need a redeploy; Vercel Edge Config is not available (self-hosted container, ADR-0007).
- Matcher: today `proxy.ts` matches three paths. Maintenance needs every path except `_next/static`, `_next/image`, fonts/favicon, `/api/health`, `/admin` and `/api/auth` (so Administrators can sign in and switch it off), via a negative-lookahead matcher.

**Recommendation.** Add a `maintenance` Platform Setting (on/off, optional FR/EN message, expected return time). In `proxy.ts`, when on and the path is not exempt, return `new Response(html, { status: 503, headers: { "Retry-After": <seconds or HTTP date>, "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" } })` for page requests and a JSON 503 for `/api/*`. The HTML is a self-contained bilingual page built from a small template (inline CSS from tokens, no React tree, no session): it must not depend on what may be down. A `/maintenance` route rendered by rewrite would return 200.

## 5. 401 → `/connexion` with origin page and "session expired"

Sources: [redirect](https://nextjs.org/docs/app/api-reference/functions/redirect) (307, 303 in Server Actions); code `app/connexion/page.tsx`, `auth/server.ts`.

- Today 23 calls (outside tests) do `if (!candidate) redirect(routes.signIn)` and `SignInForm` always gets `callbackURL={routes.account}`. better-auth already checks `callbackURL` against `trustedOrigins`, but our own `?next=` must be checked by us.
- "Expired" vs "never signed in": a session cookie present (`getSessionCookie()` from `better-auth/cookies`, already used in `auth/server.ts`) but no valid session means the session expired or was revoked.

**Recommendation.** One helper, e.g. `requireCandidate(currentPath)`, replacing those calls: `redirect(\`/connexion?suite=${encodeURIComponent(path)}${expired ? "&raison=session-expiree" : ""}\`)`. On `/connexion`, accept `suite` only if it is a same-origin **path**: starts with `/`, not `//` or `/\`, contains no control characters, and `new URL(suite, origin).origin === origin`; otherwise use `routes.account`. Pass it as `callbackURL`. `raison` is an enum (unknown values ignored) mapped to a catalogue message, never echoed text. Put the path in the URL only (no personal data in it), as the current page already does with `error`.

## 6. Real HTTP status, SEO, `noindex`

Sources: [loading.js, Status Codes](https://nextjs.org/docs/app/api-reference/file-conventions/loading#status-codes), [Streaming](https://nextjs.org/docs/app/guides/streaming); source `server/app-render/app-render.js` (`NonIndex`, error classification), `make-get-server-inserted-html.js`.

| Surface | Status (no streaming, our case) | `noindex` |
| --- | --- | --- |
| `notFound()` / unmatched URL | 404 | added by Next |
| `forbidden()` / `unauthorized()` | 403 / 401 | added by Next |
| Uncaught error in render (`error.tsx`, `global-error.tsx`) | 500 | added by Next (`NonIndex` for any status > 400) |
| `redirect()` | 307 (303 from a Server Action) | n/a |
| Proxy `Response` (maintenance) | what we set: 503 + `Retry-After` | add the meta / `X-Robots-Tag: noindex` ourselves |
| Component-rendered 403 (no flag) | 200 | add it ourselves |

- Once a response streams (a `loading.tsx` or `<Suspense>` fallback), the status is committed to 200; Next still injects `noindex` for `notFound()`/`forbidden()`/`unauthorized()` thrown later, but an error caught by `error.tsx` then stays 200.

**Recommendation.** Keep `notFound()`/`forbidden()` before any future `<Suspense>` boundary so the real status is sent; add `robots: { index: false }` / a `<meta name="robots" content="noindex">` in error pages that are not produced by an interrupt (maintenance, any component-rendered page). 503 + `Retry-After` is what search engines treat as temporary, so maintenance does not hurt indexing.
