/**
 * Passkeys as a second step (#664, ADR-0075): the WebAuthn side. Better Auth's passkey plugin registers them (Mon
 * compte) and keeps them in its `passkey` table; the check of a second step is ours (index.ts), since the plugin's own
 * check signs in, with no pending session to finish.
 */
import { getAuthenticatorName } from "@better-auth/passkey";
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";

/** Who the passkeys are made for: the web app's host (WebAuthn's RP ID) and its origin. One per environment. */
export interface RelyingParty {
  id: string;
  origin: string;
}

/** The relying party of the web app at `baseURL`: a passkey made on one host does not work on another. */
export function relyingPartyOf(baseURL: string): RelyingParty {
  const url = new URL(baseURL);
  return { id: url.hostname, origin: url.origin };
}

/** What the browser is asked to sign (WebAuthn's PublicKeyCredentialRequestOptions, as JSON). */
export type PasskeyRequest = PublicKeyCredentialRequestOptionsJSON;

/** A passkey as the `passkey` table holds it (the columns the check needs). */
export interface StoredPasskey {
  id: string;
  credentialID: string;
  publicKey: string;
  counter: number;
  transports: string | null;
}

/** What the browser is asked to sign: one of the account's passkeys, and nothing else. */
export function passkeyRequest(relyingParty: RelyingParty, passkeys: Pick<StoredPasskey, "credentialID" | "transports">[]): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: relyingParty.id,
    userVerification: "preferred",
    allowCredentials: passkeys.map((passkey) => ({ id: passkey.credentialID, transports: transportsOf(passkey.transports) })),
  });
}

/** The credential id a browser's answer names; null when it is not one. */
export function credentialIdOf(response: unknown): string | null {
  const id = typeof response === "object" && response !== null && "id" in response ? response.id : null;
  return typeof id === "string" && id.length > 0 && id.length <= 1024 ? id : null;
}

/**
 * Whether `response` is `passkey`'s signature of `challenge`, made on this relying party: its new counter when it is,
 * null when it is not (or is no answer at all).
 */
export async function checkedPasskey(relyingParty: RelyingParty, passkey: StoredPasskey, challenge: string, response: unknown): Promise<number | null> {
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: relyingParty.origin,
      expectedRPID: relyingParty.id,
      credential: { id: passkey.credentialID, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")), counter: Number(passkey.counter), transports: transportsOf(passkey.transports) },
      requireUserVerification: false,
    });
    return verified ? authenticationInfo.newCounter : null;
  } catch {
    return null;
  }
}

/** The device a passkey was made with, when its authenticator says so (Apple's never do): « Windows Hello », « 1Password »… */
export function deviceOf(aaguid: string | null | undefined): string | null {
  return getAuthenticatorName(aaguid ?? undefined) ?? null;
}

type Transport = NonNullable<Parameters<typeof generateAuthenticationOptions>[0]["allowCredentials"]>[number]["transports"];
const transportsOf = (transports: string | null): Transport => (transports ? (transports.split(",").filter(Boolean) as Transport) : undefined);
