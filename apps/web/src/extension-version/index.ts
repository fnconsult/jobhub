// The extension's package.json, bundled into the build like the root one (see release): the Extension Version this
// commit carries reaches the page with no environment variable. apps/web/Dockerfile copies it into the image's build.
import { API_VERSION } from "@jobhub/shared";
import extensionManifest from "../../../extension/package.json";
import type { Release } from "@/release";

/** The Extension Version this commit carries (CONTEXT.md, Extension Version): apps/extension/package.json's. */
export const builtExtensionVersion: string = extensionManifest.version;

/**
 * Where an Administrator downloads this deployment's zip (#989): served by the web app itself, from the image that
 * apps/web/Dockerfile builds with both zips of the Extension Version its commit carries. Not the repo's GitHub
 * Releases: the repo is private, and an Extension Version's Release only exists once the product owner runs
 * extension.yml (docs/ops/extension.md).
 */
export const EXTENSION_TEST_BUILD_URL = "/api/account/extension-test-build";

/** What an Administrator reads in Outils to load the latest extension unpacked, before the store review (#920). */
export interface ExtensionTestBuild {
  /** The Extension Version this deployment's commit carries. */
  extensionVersion: string;
  /** The API Version the server serves: an extension that states an older one than the one before is asked to update (proxy.ts). */
  apiVersion: number;
  /** The zip tied to this environment: the beta one on the Beta, the public one in Production (extension.yml, apps/web/Dockerfile). */
  zip: string;
  downloadUrl: string;
}

export function extensionTestBuild(
  release: Pick<Release, "beta">,
  extensionVersion: string = builtExtensionVersion,
  apiVersion: number = API_VERSION,
): ExtensionTestBuild {
  return {
    extensionVersion,
    apiVersion,
    zip: `jobbbox-extension-${extensionVersion}-chrome${release.beta ? "-beta" : ""}.zip`,
    downloadUrl: EXTENSION_TEST_BUILD_URL,
  };
}
