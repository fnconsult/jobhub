/**
 * A software passkey for tests (WebAuthn Level 2, ES256, attestation "none"): what a browser and an authenticator answer
 * to the options of a registration or an authentication, as the JSON SimpleWebAuthn's browser side posts. Tests only.
 *
 *   const key = createTestAuthenticator({ origin: "http://localhost:3000" });
 *   const registration = key.register(registrationOptions);   // posted to /api/auth/passkey/verify-registration
 *   const assertion = key.authenticate(authenticationOptions); // posted to the second step
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { BASE_URL, cookiesFrom, type TestAuth } from "../auth/test-support";

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  const bytes = Buffer.alloc(3);
  bytes[0] = (major << 5) | 25;
  bytes.writeUInt16BE(length, 1);
  return bytes;
}

/** The few CBOR types an attestation object and a COSE key need. */
function cbor(value: Cbor): Buffer {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

export interface TestAuthenticator {
  /** The credential's id, base64url, as WebAuthn and the `passkey` table hold it. */
  readonly credentialId: string;
  /** The registration response to `options` (from /passkey/generate-register-options). */
  register(options: { challenge: string; rp: { id?: string } }): Record<string, unknown>;
  /**
   * The authentication response to `options` (from the second step's passkey challenge), made at `origin`: by default the
   * key's own, or another, as the native app's (an Android app's signing certificate, #688) for a passkey of the site.
   */
  authenticate(options: { challenge: string; rpId?: string }, origin?: string): Record<string, unknown>;
}

export function createTestAuthenticator({ origin, aaguid = new Uint8Array(16) }: { origin: string; aaguid?: Uint8Array }): TestAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(16);
  let counter = 0;
  const rpIdOf = (rpId: string | undefined) => rpId ?? new URL(origin).hostname;
  const clientData = (type: string, challenge: string, at = origin) => Buffer.from(JSON.stringify({ type, challenge, origin: at, crossOrigin: false }));
  const counterBytes = () => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(++counter);
    return bytes;
  };

  return {
    credentialId: base64url(id),

    register(options) {
      const coseKey = cbor(
        new Map<Cbor, Cbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x!, "base64url")],
          [-3, Buffer.from(jwk.y!, "base64url")],
        ]),
      );
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      // User present, user verified, attested credential data included.
      const authData = Buffer.concat([sha256(rpIdOf(options.rp.id)), Buffer.from([0x45]), counterBytes(), Buffer.from(aaguid), length, id, coseKey]);
      const attestationObject = cbor(
        new Map<Cbor, Cbor>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      );
      return {
        id: base64url(id),
        rawId: base64url(id),
        type: "public-key",
        response: { clientDataJSON: base64url(clientData("webauthn.create", options.challenge)), attestationObject: base64url(attestationObject), transports: ["internal"] },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },

    authenticate(options, at) {
      const clientDataJSON = clientData("webauthn.get", options.challenge, at);
      const authenticatorData = Buffer.concat([sha256(rpIdOf(options.rpId)), Buffer.from([0x05]), counterBytes()]);
      const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), privateKey);
      return {
        id: base64url(id),
        rawId: base64url(id),
        type: "public-key",
        response: { clientDataJSON: base64url(clientDataJSON), authenticatorData: base64url(authenticatorData), signature: base64url(signature) },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
}

/**
 * Adds a passkey to the account signed in with `cookie`, as Mon compte does through Better Auth's passkey plugin; returns
 * its id in the `passkey` table and the key, to answer a second step with.
 */
export async function addTestPasskey(testAuth: TestAuth, cookie: string, name: string, key: TestAuthenticator = createTestAuthenticator({ origin: BASE_URL })) {
  const optionsResponse = await testAuth.request("/api/auth/passkey/generate-register-options", { cookie });
  if (!optionsResponse.ok) throw new Error(`register options: ${optionsResponse.status} ${await optionsResponse.text()}`);
  const withChallenge = `${cookie}; ${cookiesFrom(optionsResponse)}`;
  const verified = await testAuth.request("/api/auth/passkey/verify-registration", { cookie: withChallenge, body: { response: key.register(await optionsResponse.json()), name } });
  if (!verified.ok) throw new Error(`register: ${verified.status} ${await verified.text()}`);
  const { id } = (await verified.json()) as { id: string };
  return { id, key };
}
