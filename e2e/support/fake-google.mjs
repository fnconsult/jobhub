// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for
// Google's token endpoint, the one call the server makes to Google itself.
// The browser side of the dance (accounts.google.com) is faked by the test,
// which passes the person's Google identity as the authorization `code`:
// base64url(JSON claims). We answer with an ID token carrying those claims.
const realFetch = globalThis.fetch;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://oauth2.googleapis.com/token")) return realFetch(input, init);
  const body = new URLSearchParams(input instanceof Request ? await input.text() : String(init?.body ?? ""));
  const claims = JSON.parse(Buffer.from(body.get("code") ?? "", "base64url").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  const idToken = [
    encode({ alg: "RS256", typ: "JWT" }),
    encode({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, iat: now, exp: now + 3600, ...claims }),
    "signature",
  ].join(".");
  return Response.json({
    access_token: "fake-google-access-token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "openid email profile",
    id_token: idToken,
  });
};
