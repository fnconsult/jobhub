import { APP_IDENTIFIER, APP_SIGN_IN_PATH } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { DOMAIN_ASSOCIATION_FILES, domainAssociation } from "./domain-association";

const ENV = { APPLE_TEAM_ID: "ABCDE12345", ANDROID_CERT_SHA256: " AA:BB:CC , DD:EE:FF " };

describe("the domain association files the native app's links are verified with (#685)", () => {
  it("are served at the addresses Apple and Android read", () => {
    expect(DOMAIN_ASSOCIATION_FILES).toEqual(["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]);
  });

  it("let the iOS app open the magic link's address, and no other, and use the site's passkeys (#688)", () => {
    expect(domainAssociation("/.well-known/apple-app-site-association", ENV)).toEqual({
      applinks: { details: [{ appIDs: [`ABCDE12345.${APP_IDENTIFIER}`], components: [{ "/": APP_SIGN_IN_PATH }] }] },
      webcredentials: { apps: [`ABCDE12345.${APP_IDENTIFIER}`] },
    });
  });

  it("let the Android app signed with each listed certificate open the site's links and use its passkeys (#688)", () => {
    expect(domainAssociation("/.well-known/assetlinks.json", ENV)).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
        target: { namespace: "android_app", package_name: APP_IDENTIFIER, sha256_cert_fingerprints: ["AA:BB:CC", "DD:EE:FF"] },
      },
    ]);
  });

  it("are not served while the app's signing is not configured", () => {
    expect(domainAssociation("/.well-known/apple-app-site-association", {})).toBeNull();
    expect(domainAssociation("/.well-known/assetlinks.json", { ANDROID_CERT_SHA256: " , " })).toBeNull();
  });
});
