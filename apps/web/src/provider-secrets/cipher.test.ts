import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { secretCipherFromEnv, SecretDecryptionError, type SealedSecret } from "./cipher";

const key = () => randomBytes(32).toString("base64");
const AAD = { provider: "mistral", name: "MISTRAL_API_KEY", row: "row-1" };
const VALUE = "sk-mistral-0123456789abcdef";

describe("the Provider Secrets cipher (AES-256-GCM under SECRETS_MASTER_KEYS)", () => {
  it("seals a value under the newest master key and opens it back", () => {
    const cipher = secretCipherFromEnv({ SECRETS_MASTER_KEYS: `1:${key()},2:${key()}` })!;

    const sealed = cipher.seal(VALUE, AAD);

    expect(sealed.keyVersion).toBe(2);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.tag).toHaveLength(16);
    expect(sealed.ciphertext.toString("utf8")).not.toContain(VALUE);
    expect(cipher.open(sealed, AAD)).toBe(VALUE);
  });

  it("never seals twice alike: a fresh IV each time", () => {
    const cipher = secretCipherFromEnv({ SECRETS_MASTER_KEYS: `1:${key()}` })!;

    const [a, b] = [cipher.seal(VALUE, AAD), cipher.seal(VALUE, AAD)];

    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it.each([
    ["another provider", { ...AAD, provider: "perplexity" }],
    ["another name", { ...AAD, name: "PERPLEXITY_API_KEY" }],
    ["another row", { ...AAD, row: "row-2" }],
  ])("refuses to open a value moved to %s (AAD)", (_, moved) => {
    const cipher = secretCipherFromEnv({ SECRETS_MASTER_KEYS: `1:${key()}` })!;

    expect(() => cipher.open(cipher.seal(VALUE, AAD), moved)).toThrow(SecretDecryptionError);
  });

  it.each<[string, (sealed: SealedSecret) => SealedSecret]>([
    ["its ciphertext", (sealed) => ({ ...sealed, ciphertext: flip(sealed.ciphertext) })],
    ["its tag", (sealed) => ({ ...sealed, tag: flip(sealed.tag) })],
    ["its IV", (sealed) => ({ ...sealed, iv: flip(sealed.iv) })],
    ["its key version", (sealed) => ({ ...sealed, keyVersion: 1 })],
  ])("refuses to open a row with tampered %s, and says nothing of the value", (_, tamper) => {
    const cipher = secretCipherFromEnv({ SECRETS_MASTER_KEYS: `1:${key()},2:${key()}` })!;

    const opening = () => cipher.open(tamper(cipher.seal(VALUE, AAD)), AAD);

    expect(opening).toThrow(SecretDecryptionError);
    try {
      opening();
    } catch (error) {
      expect(String(error)).not.toContain(VALUE);
    }
  });

  it("opens a row sealed under an older master key while it is still listed, and refuses it once removed", () => {
    const [v1, v2] = [key(), key()];
    const sealed = secretCipherFromEnv({ SECRETS_MASTER_KEYS: `1:${v1}` })!.seal(VALUE, AAD);

    expect(secretCipherFromEnv({ SECRETS_MASTER_KEYS: `1:${v1},2:${v2}` })!.open(sealed, AAD)).toBe(VALUE);
    expect(() => secretCipherFromEnv({ SECRETS_MASTER_KEYS: `2:${v2}` })!.open(sealed, AAD)).toThrow(SecretDecryptionError);
  });

  it("lists its key versions, the newest active whatever their order", () => {
    const cipher = secretCipherFromEnv({ SECRETS_MASTER_KEYS: ` 3:${key()} , 1:${key()}` })!;

    expect(cipher.versions).toEqual([1, 3]);
    expect(cipher.activeVersion).toBe(3);
  });

  it("is absent without SECRETS_MASTER_KEYS: Provider Secrets come from env only", () => {
    expect(secretCipherFromEnv({})).toBeNull();
    expect(secretCipherFromEnv({ SECRETS_MASTER_KEYS: " " })).toBeNull();
  });

  it.each([
    ["no version", key()],
    ["a version that is not a positive whole number", `v1:${key()}`],
    ["a key that is not 32 bytes", `1:${randomBytes(16).toString("base64")}`],
    ["a version listed twice", `1:${key()},1:${key()}`],
  ])("refuses a keyring with %s, without echoing the keys", (_, keyring) => {
    const reading = () => secretCipherFromEnv({ SECRETS_MASTER_KEYS: keyring });

    expect(reading).toThrow(/SECRETS_MASTER_KEYS/);
    try {
      reading();
    } catch (error) {
      for (const part of keyring.split(/[,:]/).filter((part) => part.length > 8)) expect(String(error)).not.toContain(part);
    }
  });
});

function flip(buffer: Buffer): Buffer {
  const copy = Buffer.from(buffer);
  copy[0] = copy[0]! ^ 0xff;
  return copy;
}
