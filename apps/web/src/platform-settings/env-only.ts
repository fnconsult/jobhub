/**
 * The settings only env holds, as Paramètres shows them, read-only (ADR-0033): the
 * bootstrap settings, MAIL_TRANSPORT and the Stripe Prices. A secret never leaves this
 * module: DATABASE_URL loses its password, AUTH_SECRET is only set or missing, and
 * SECRETS_MASTER_KEYS only gives its versions.
 */
import { secretCipherFromEnv } from "../provider-secrets/cipher";
import { ENV_ONLY_SETTINGS, RETIRED_SETTINGS, type EnvOnlyKind, type EnvOnlySettingName, type RetiredBy, type RetiredSettingName } from "./catalog";

type Env = Record<string, string | undefined>;

/** What Paramètres shows of a value. */
export type ShownValue =
  | { kind: "value"; value: string }
  | { kind: "set" }
  | { kind: "missing" }
  | { kind: "key_versions"; versions: number[] }
  /** Set, but not readable as what it should be: nothing of it is shown. */
  | { kind: "unreadable" };

export interface EnvOnlyRow {
  name: EnvOnlySettingName;
  kind: EnvOnlyKind;
  shown: ShownValue;
  /** `mail_to_console`: MAIL_TRANSPORT=console outside e2e, emails only go to the server log. */
  warning: "mail_to_console" | null;
}

/** A query parameter that may carry a credential. */
const CREDENTIAL = /pass|secret|key|token/i;

/** A connection URL without its password, nor any query parameter that may carry one. */
function withoutPassword(raw: string): ShownValue {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unreadable" };
  }
  url.password = "";
  for (const name of [...url.searchParams.keys()]) if (CREDENTIAL.test(name)) url.searchParams.delete(name);
  return { kind: "value", value: url.toString() };
}

function keyVersions(env: Env): ShownValue {
  try {
    const cipher = secretCipherFromEnv(env);
    return cipher ? { kind: "key_versions", versions: [...cipher.versions] } : { kind: "missing" };
  } catch {
    return { kind: "unreadable" };
  }
}

/** Every setting only env holds that Paramètres shows, in its order. */
export function envOnlySettingsShown(env: Env): EnvOnlyRow[] {
  return (Object.entries(ENV_ONLY_SETTINGS) as [EnvOnlySettingName, (typeof ENV_ONLY_SETTINGS)[EnvOnlySettingName]][]).flatMap(([name, setting]): EnvOnlyRow[] => {
    if (!setting.shown) return [];
    const raw = env[name]?.trim();
    const shown: ShownValue =
      setting.shown === "key_versions"
        ? keyVersions(env)
        : !raw
          ? { kind: "missing" }
          : setting.shown === "set_or_missing"
            ? { kind: "set" }
            : setting.shown === "without_password"
              ? withoutPassword(raw)
              : { kind: "value", value: raw };
    const mailToConsole = name === "MAIL_TRANSPORT" && raw === "console" && env.JOBHUB_TARGET?.trim() !== "e2e";
    return [{ name, kind: setting.kind, shown, warning: mailToConsole ? "mail_to_console" : null }];
  });
}

/** The variables Jobbbox no longer reads that `env` still sets, with what took their place; never their value (#396). */
export function retiredSettingsSet(env: Env): { name: RetiredSettingName; replacedBy: RetiredBy }[] {
  return (Object.entries(RETIRED_SETTINGS) as [RetiredSettingName, RetiredBy][]).filter(([name]) => env[name]?.trim()).map(([name, replacedBy]) => ({ name, replacedBy }));
}
