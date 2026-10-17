// Preloaded (NODE_OPTIONS=--import) into the web server of e2e/sign-in-providers.spec.ts
// to stand in for an OIDC issuer at https://sso.e2e.jobbbox.test: the server-side calls
// (discovery document, signing keys, code exchange). The browser side (the authorize
// page) is played by the test, which passes the person's identity, and the nonce it was
// asked to sign, as the authorization `code`: base64url(JSON claims). We answer with an
// ID token carrying those claims, signed with a key made at start, checked by the app
// against our JWKS like a real issuer's.
import { generateKeyPairSync, sign } from "node:crypto";

export const FAKE_OIDC_ISSUER = "https://sso.e2e.jobbbox.test";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(`${FAKE_OIDC_ISSUER}/`)) return realFetch(input, init);
  const path = new URL(url).pathname;
  if (path === "/.well-known/openid-configuration") {
    return Response.json({
      issuer: FAKE_OIDC_ISSUER,
      authorization_endpoint: `${FAKE_OIDC_ISSUER}/authorize`,
      token_endpoint: `${FAKE_OIDC_ISSUER}/token`,
      userinfo_endpoint: `${FAKE_OIDC_ISSUER}/userinfo`,
      jwks_uri: `${FAKE_OIDC_ISSUER}/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }
  if (path === "/jwks") return Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "e2e-issuer", alg: "RS256", use: "sig" }] });
  if (path === "/token") {
    const body = new URLSearchParams(input instanceof Request ? await input.text() : String(init?.body ?? ""));
    const { aud, ...claims } = JSON.parse(Buffer.from(body.get("code") ?? "", "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "RS256", typ: "JWT", kid: "e2e-issuer" })}.${encode({ iss: FAKE_OIDC_ISSUER, aud, iat: now, exp: now + 3600, ...claims })}`;
    const idToken = `${unsigned}.${sign("sha256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`;
    return Response.json({ access_token: "fake-oidc-access-token", token_type: "Bearer", expires_in: 3600, id_token: idToken });
  }
  return new Response("not found", { status: 404 });
};
