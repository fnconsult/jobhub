# A fallback container behind Traefik answers with Jobbbox's error page while the web app does not

Status: accepted

The VPS's Traefik (shared with other apps, configured outside the repo) routes an environment's host to its web container by the container's Docker labels. Traefik drops those routes while the container is stopped, starting or unhealthy. That happens on every deploy: the old container stops, and the new one is not routed until its health check passes, 10 to 40 seconds later. It also happens after a crash. During that time Traefik answered every request with its own white page, `404 page not found`, and a container that was routed but not answering got `Bad Gateway` or `Gateway Timeout`. None of these went through Jobbbox's error pages (#542). The product owner met the 404 on the Beta.

- **An `edge` service in deploy/compose.yml** (nginx, `deploy/edge/nginx.conf`) has a router for the environment's host at priority 1. The web container's routers are at 20 (pages) and 30 (API), so the edge router only answers while they are gone. It answers 503 with `Retry-After`: Jobbbox's page under any path, or `{"error":"unavailable"}` under `/api`.
- **The web pages' router has an `errors` middleware for 502 and 504**, served by `edge`. When the routed container does not answer, the browser gets the same page with Traefik's status. The app's own answers pass untouched, its 500 page and maintenance's 503 included.
- **The API has its own router, without that middleware**: the API's JSON passes untouched, including the 502 JSON of a refused coaching order. While the web container is routed but not answering, an API client still gets Traefik's `Bad Gateway` text, as before.
- **The pages are generated and self-contained**: `apps/web/src/edge/pages.ts` writes `deploy/edge/pages/<code>.<fr|en>.html` (`npm run edge-pages -w @jobhub/web`), with the same renderer as maintenance's page (`src/design/self-contained-page.ts`), and a unit test fails while the committed files differ. Each page has both languages. The URL's language comes first (English under `/en` or with `?lang=en`), and French first for the `errors` middleware, which does not pass on the address. Each page reloads itself every 15 seconds.
- **The checkout's `deploy/edge` directory is mounted**, not a file, so a new revision's checkout is seen. `deploy.sh` starts `edge` and reloads it (HUP) before it replaces the web container.
- **No access log**: the container keeps no address or path.

Not covered: a host that has no route on the VPS at all (a name the DNS points at the VPS that no environment serves). Only the shared Traefik could catch those, and a catch-all there would also catch the other apps' hosts. Without a certificate for such a name, a browser stops at the TLS warning before any page anyway.

`e2e/edge.spec.ts` runs Traefik (v3.6; `E2E_TRAEFIK_IMAGE` runs it on another version, and v2.11 passes too) with the labels of deploy/compose.yml, the `edge` container as the VPS runs it, and a stand-in web container in front of the suite's web server.

## Considered Options

- **Configuring the shared Traefik** (its own error pages, a catch-all router): rejected: it is outside the repo and shared with other apps, and a deploy could not apply or test it.
- **Keeping the old web container until the new one is healthy** (blue-green): rejected for now: it does not help after a crash, and it needs two web containers' memory on a shared VPS. The fallback covers both cases.
- **An `errors` middleware on every router, for 503 too**: rejected: it would replace maintenance's 503 page and the API's own 502 and 503 JSON.
- **One bilingual page in a fixed order**: rejected: the URL says which language a visitor reads, so that language comes first.
