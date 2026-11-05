// Which platform a build of each EAS profile talks to (#704, ADR-0076): the address eas.json bakes into the bundle, read
// where the app reads it, for its sign-in and session, its calls to the API and the web addresses it shares.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const eas = JSON.parse(readFileSync(join(__dirname, "..", "eas.json"), "utf8")) as { build: Record<string, { env?: Record<string, string> }> };

/** The app's modules as a build of `profile` loads them: with only that profile's `EXPO_PUBLIC_*` variables, afresh. */
function buildOf(profile: string) {
  const saved = process.env;
  process.env = Object.fromEntries(Object.entries(saved).filter(([key]) => !key.startsWith("EXPO_PUBLIC_"))) as NodeJS.ProcessEnv;
  Object.assign(process.env, eas.build[profile]?.env);
  try {
    let modules!: {
      session: typeof import("../src/session/instance");
      links: typeof import("../src/navigation/links");
      api: typeof import("../src/api/api");
      testing: typeof import("../src/testing");
      rntl: typeof import("@testing-library/react-native");
    };
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      modules = {
        session: require("../src/session/instance"),
        links: require("../src/navigation/links"),
        api: require("../src/api/api"),
        testing: require("../src/testing"),
        rntl: require("@testing-library/react-native"),
      };
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    return modules;
  } finally {
    process.env = saved;
  }
}

describe.each([
  ["development", "https://staging.jobbbox.ai"],
  ["staging", "https://staging.jobbbox.ai"],
  ["production", "https://jobbbox.ai"],
])("a build of the %s profile", (profile, origin) => {
  const { session, links, api, testing, rntl } = buildOf(profile);
  afterEach(() => jest.restoreAllMocks());

  it(`signs in and keeps its session on ${origin}`, () => {
    expect(new URL(session.WEB_APP_URL).origin).toBe(origin);
  });

  it(`calls the API on ${origin}`, async () => {
    const called: string[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      called.push(String(url));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    let call!: ReturnType<typeof api.useApi>;
    function Probe() {
      call = api.useApi();
      return null;
    }
    await testing.renderInApp(<Probe />);
    await rntl.act(() => call.fetch("/api/applications"));
    expect(called.map((url) => new URL(url).origin)).toEqual([origin]);
  });

  it(`shares the addresses of its pages on ${origin}`, () => {
    expect(new URL(links.webAddress("/candidatures")).origin).toBe(origin);
  });
});
