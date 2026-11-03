import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pendingSessionGate, SECOND_STEP_ENDPOINT, SECOND_STEP_PAGE, SETUP_ENDPOINT } from "../two-step-verification/gate";

// ADR-0075, #663: a session pending its second step reaches the second step's page, its endpoint and sign-out, nothing
// else. The proxy applies the gate to every request (src/proxy.ts), so a route cannot be forgotten by its own code; this
// lists every page and route of the app, as Next serves them, and proves what each answers such a session.
const app = fileURLToPath(new URL("./", import.meta.url));

/** Every file under `path` named `name`. */
function named(path: string, name: string): string[] {
  if (statSync(path).isFile()) return path.endsWith(`${sep}${name}`) ? [path] : [];
  return readdirSync(path).flatMap((entry) => named(join(path, entry), name));
}

/** The address a page or route answers at: route groups left out, a dynamic segment filled in. */
function routeOf(file: string): string {
  const segments = relative(app, dirname(file))
    .split(sep)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment))
    .map((segment) => (/^\[\.\.\..*\]$/.test(segment) ? "x/y" : /^\[.*\]$/.test(segment) ? "x" : segment));
  return `/${segments.join("/")}`;
}

/** The HTTP methods a route file exports. */
function methodsOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/export (?:(?:async )?function|const) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((match) => match[1]!);
}

const PAGES = named(app, "page.tsx").map(routeOf);
const ROUTES = named(app, "route.ts").map((file) => ({ route: routeOf(file), methods: methodsOf(file) }));
const AUTH = "/api/auth/x/y";

describe("a session pending its second step reaches nothing else (ADR-0075)", () => {
  it("finds the app's pages and routes, the second step's among them", () => {
    expect(PAGES.length).toBeGreaterThan(40);
    expect(PAGES).toContain(SECOND_STEP_PAGE);
    expect(ROUTES.length).toBeGreaterThan(40);
    expect(ROUTES.map(({ route }) => route)).toEqual(expect.arrayContaining([SECOND_STEP_ENDPOINT, SETUP_ENDPOINT, AUTH]));
    for (const { route, methods } of ROUTES) expect(methods.length, route).toBeGreaterThan(0);
  });

  it.each(PAGES.filter((page) => page !== SECOND_STEP_PAGE))("page %s sends it to the second step", (page) => {
    expect(pendingSessionGate(page, "GET")).toBe("redirect");
    // A Server Action is posted to its page.
    expect(pendingSessionGate(page, "POST")).toBe("refuse");
  });

  it("opens the second step's page", () => {
    expect(pendingSessionGate(SECOND_STEP_PAGE, "GET")).toBe("open");
  });

  it.each(ROUTES.filter(({ route }) => route !== SECOND_STEP_ENDPOINT && route !== SETUP_ENDPOINT && route !== AUTH))("route $route answers 401", ({ route, methods }) => {
    for (const method of methods) expect(pendingSessionGate(route, method), method).toBe("refuse");
  });

  it("opens the setup's endpoint, which answers only an account that must have it and has no factor (#665)", () => {
    const setup = ROUTES.find(({ route }) => route === SETUP_ENDPOINT)!;
    for (const method of setup.methods) expect(pendingSessionGate(SETUP_ENDPOINT, method), method).toBe("open");
    expect(readFileSync(join(app, "api/two-step-verification/setup/route.ts"), "utf8")).toContain('step !== "setup"');
  });

  it("opens the second step's endpoint and, of Better Auth's endpoints, sign-out and a new sign-in by magic link alone", () => {
    expect(pendingSessionGate(SECOND_STEP_ENDPOINT, "POST")).toBe("open");
    expect(pendingSessionGate("/api/auth/sign-out", "POST")).toBe("open");
    expect(pendingSessionGate("/api/auth/magic-link/verify?token=t", "GET")).toBe("open");
    for (const endpoint of ["get-session", "list-sessions", "update-user", "delete-user", "link-social", "list-accounts", "sign-in/magic-link", "sign-in/social", "revoke-sessions"]) {
      expect(pendingSessionGate(`/api/auth/${endpoint}`, "POST"), endpoint).toBe("refuse");
      expect(pendingSessionGate(`/api/auth/${endpoint}`, "GET"), endpoint).toBe("refuse");
    }
  });

  it("applies to every page and route: the proxy's matcher leaves none of them out", () => {
    const proxy = readFileSync(join(app, "..", "proxy.ts"), "utf8");
    const matcher = /matcher: \["([^"]+)"\]/.exec(proxy)?.[1];
    expect(matcher).toBe("/((?!_next/static|_next/image|favicon.ico).*)");
    const matches = new RegExp(`^${matcher}$`);
    for (const path of [...PAGES, ...ROUTES.map(({ route }) => route)]) expect(matches.test(path), path).toBe(true);
    expect(proxy).toContain("await pendingSessionAnswer(request)");
  });
});
