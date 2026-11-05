// End-to-end for crash reports (#703, ADR-0076): the app's real entry (the root layout Expo Router loads at launch) is
// started the way a build starts it, and what leaves the device is read at the SDK's boundary (Sentry's init options).
jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
const mockInit = jest.fn();
jest.mock("@sentry/react-native", () => ({ init: (options: unknown) => mockInit(options) }));

const EU_DSN = "https://abc123@o42.ingest.de.sentry.io/7";
const g = globalThis as unknown as { __DEV__: boolean };
const original = { dev: g.__DEV__, dsn: process.env.EXPO_PUBLIC_SENTRY_DSN };

/** Launches the app as a build would: the root layout loaded fresh, with the build's mode and environment. */
function launchApp(env: { dev: boolean; dsn?: string }) {
  g.__DEV__ = env.dev;
  if (env.dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = env.dsn;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../src/app/_layout");
  });
}

beforeEach(() => mockInit.mockClear());
afterAll(() => {
  g.__DEV__ = original.dev;
  if (original.dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = original.dsn;
});

describe("Crash reports at the app's launch", () => {
  it("sends nothing from a development build, even with a DSN in the configuration", () => {
    launchApp({ dev: true, dsn: EU_DSN });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("sends nothing from a release build without a DSN", () => {
    launchApp({ dev: false });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("sends nothing to a DSN outside Sentry's EU region", () => {
    launchApp({ dev: false, dsn: "https://abc123@o42.ingest.sentry.io/7" });
    launchApp({ dev: false, dsn: "https://abc123@o42.ingest.us.sentry.io/7" });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("reports from a release build to the EU DSN of its configuration, once, without product analytics", () => {
    launchApp({ dev: false, dsn: EU_DSN });
    expect(mockInit).toHaveBeenCalledTimes(1);
    const options = mockInit.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: EU_DSN,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAutoSessionTracking: false,
      enableLogs: false,
    });
    for (const analytics of ["tracesSampleRate", "tracesSampler", "profilesSampleRate", "replaysSessionSampleRate", "replaysOnErrorSampleRate", "integrations"]) {
      expect(options).not.toHaveProperty(analytics);
    }
  });

  it("cleans a crash event on the device before it leaves: no user, request body or identifiers", () => {
    launchApp({ dev: false, dsn: EU_DSN });
    const { beforeSend, beforeBreadcrumb } = mockInit.mock.calls[0][0];
    const sent = beforeSend({
      type: undefined,
      user: { id: "u-1", email: "ada@example.com", ip_address: "203.0.113.9" },
      request: {
        method: "POST",
        url: "https://user:secret@app.jobbbox.ai/api/applications/3f2c9a7e-1111-4222-8333-944455556666?token=abc#frag",
        data: '{"cv":"my private cv"}',
        cookies: { session: "s3cr3t" },
        headers: { Authorization: "Bearer xyz" },
        query_string: "token=abc",
      },
      contexts: { device: { id: "DEVICE-ID", name: "Ada's iPhone", model: "iPhone15,2" } },
      message: "Failed for ada@example.com at https://app.jobbbox.ai/api/users/42?x=1",
      breadcrumbs: [
        { category: "ui.input", message: "typed: my password" },
        { category: "touch", message: "Button > Send" },
        { category: "fetch", data: { method: "GET", url: "https://app.jobbbox.ai/api/users/42?email=a@b.co", status_code: 200, request_body: "secret" } },
      ],
    });
    const serialized = JSON.stringify(sent);
    for (const leaked of ["u-1", "ada@example.com", "203.0.113.9", "secret", "s3cr3t", "Bearer", "my private cv", "token=abc", "DEVICE-ID", "Ada's iPhone", "3f2c9a7e", "my password", "Button > Send", "request_body", "frag"]) {
      expect(serialized).not.toContain(leaked);
    }
    expect(sent.contexts.device.model).toBe("iPhone15,2");
    expect(sent.request.url).toBe("https://app.jobbbox.ai/api/applications/:id");
    expect(sent.breadcrumbs).toHaveLength(1);
    expect(beforeBreadcrumb({ category: "ui.click", message: "tapped Mot de passe" })).toBeNull();
  });
});
