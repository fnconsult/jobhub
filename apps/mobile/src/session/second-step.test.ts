import { createAppSession, type DevicePasskeys } from "./app-session";
import { fakeWebApp, memoryStorage, TEST_BASE_URL } from "./testing";

const EMAIL = "marie.dupont@example.fr";
const COACH = "claire.coach@example.fr";

function setUp({ passkeys }: { passkeys?: DevicePasskeys } = {}) {
  const web = fakeWebApp();
  const storage = memoryStorage();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage, fetch: web.fetch, passkeys: passkeys ?? web.deviceWithoutPasskey() });
  /** Signs in by the emailed link, as opening it in the app does. */
  const signIn = async (email = EMAIL) => {
    await session.askLink(email);
    return session.openLink(web.linkFor(email));
  };
  return { web, storage, session, signIn };
}

// The second step in the app (#688, ADR-0075): on the web app's own endpoints, with its limits.
describe("the app's second step", () => {
  it("says what the pending session can use: the authenticator app's code, a backup code, and the account's passkey on a device that has passkeys", async () => {
    const { web, session, signIn } = setUp();
    web.withSecondStep(EMAIL, { app: true, passkey: true });
    await signIn();

    expect(await session.secondStep()).toEqual({ kind: "factors", app: true, passkey: true });
  });

  it("offers no passkey on a device that cannot use one (Android before 9)", async () => {
    const web = fakeWebApp();
    const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch, passkeys: web.unsupportedDevice() });
    web.withSecondStep(EMAIL, { app: true, passkey: true });
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));

    expect(await session.secondStep()).toEqual({ kind: "factors", app: true, passkey: false });
  });

  it("offers no passkey to an account without one", async () => {
    const { web, session, signIn } = setUp();
    web.withSecondStep(EMAIL, { app: true });
    await signIn();

    expect(await session.secondStep()).toEqual({ kind: "factors", app: true, passkey: false });
  });

  it("sends an account that must have it and has no factor yet (a Human Coach) to the setup", async () => {
    const { web, session, signIn } = setUp();
    web.mustSetUp(COACH);

    expect(await signIn(COACH)).toEqual({ kind: "secondStep" });
    expect(await session.secondStep()).toEqual({ kind: "setup" });
  });

  it("has nothing to ask a session that is signed in", async () => {
    const { session, signIn } = setUp();
    await signIn();

    expect(await session.secondStep()).toBeNull();
  });

  it("is released by a valid code of the authenticator app: signed in", async () => {
    const { web, session, signIn } = setUp();
    web.withSecondStep(EMAIL, { app: true });
    await signIn();

    expect(await session.verifyCode(web.appCode())).toEqual({ ok: true, session: { kind: "signedIn", email: EMAIL } });
    expect(await session.current()).toEqual({ kind: "signedIn", email: EMAIL });
  });

  it("is released by a backup code", async () => {
    const { web, session, signIn } = setUp();
    web.withSecondStep(EMAIL, { app: true });
    await signIn();

    expect(await session.verifyCode(web.backupCode(EMAIL))).toEqual({ ok: true, session: { kind: "signedIn", email: EMAIL } });
  });

  it("refuses a wrong code, the session staying pending, and is locked as on the web after 5", async () => {
    const { web, session, signIn } = setUp();
    web.withSecondStep(EMAIL, { app: true });
    await signIn();

    for (let attempt = 1; attempt < 5; attempt++) expect(await session.verifyCode("000000")).toEqual({ ok: false, error: "invalid" });
    expect(await session.current()).toEqual({ kind: "secondStep" });
    expect(await session.verifyCode("000000")).toEqual({ ok: false, error: "locked", retryAt: expect.any(Date) });
    expect(await session.verifyCode(web.appCode())).toEqual({ ok: false, error: "locked", retryAt: expect.any(Date) });
    expect(await session.current()).toEqual({ kind: "secondStep" });
  });

  it("is released by the account's passkey, asked of the system", async () => {
    const web = fakeWebApp();
    const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch, passkeys: web.deviceWithPasskeyOf(EMAIL) });
    web.withSecondStep(EMAIL, { app: false, passkey: true });
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));

    expect(await session.verifyPasskey()).toEqual({ ok: true, session: { kind: "signedIn", email: EMAIL } });
  });

  it("refuses a passkey of another account: the session stays pending", async () => {
    const web = fakeWebApp();
    const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch, passkeys: web.deviceWithPasskeyOf("paul.martin@example.fr") });
    web.withSecondStep(EMAIL, { app: false, passkey: true });
    web.withSecondStep("paul.martin@example.fr", { app: false, passkey: true });
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));

    expect(await session.verifyPasskey()).toEqual({ ok: false, error: "invalid" });
    expect(await session.current()).toEqual({ kind: "secondStep" });
  });

  it("says when the passkey was not used, the session staying pending", async () => {
    const { web, session, signIn } = setUp();
    web.withSecondStep(EMAIL, { app: false, passkey: true });
    await signIn();

    expect(await session.verifyPasskey()).toEqual({ ok: false, error: "cancelled" });
    expect(await session.current()).toEqual({ kind: "secondStep" });
  });

  it("says when the web app cannot be reached", async () => {
    const { web, session, signIn } = setUp();
    web.withSecondStep(EMAIL, { app: true });
    await signIn();
    web.setOffline(true);

    expect(await session.verifyCode(web.appCode())).toEqual({ ok: false, error: "error" });
    expect(await session.verifyPasskey()).toEqual({ ok: false, error: "error" });
  });

  it("keeps nothing of it on the device: secure storage holds the session alone", async () => {
    const { web, storage, session, signIn } = setUp();
    web.withSecondStep(EMAIL, { app: true });
    await signIn();
    const code = web.appCode();
    const before = [...storage.values.keys()].sort();

    await session.verifyCode("000000");
    await session.verifyCode(code);

    expect([...storage.values.keys()].sort()).toEqual(before);
    for (const value of storage.values.values()) expect(value).not.toContain(code);
  });
});
