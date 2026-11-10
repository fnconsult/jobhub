// The extension's package.json, bundled into the build like the root one (see release): the Extension Version this
// commit carries reaches the page with no environment variable. apps/web/Dockerfile copies it into the image's build.
import { API_VERSION } from "@jobhub/shared";
import extensionManifest from "../../../extension/package.json";
import type { Release } from "@/release";

/** The Extension Version this commit carries (CONTEXT.md, Extension Version): apps/extension/package.json's. */
export const builtExtensionVersion: string = extensionManifest.version;

/**
 * The repo's GitHub Releases, filtered on the Extension Versions (`extension-vX.Y.Z`, made by extension.yml with both
 * zips): not `releases/latest`, which stays the web app's Version (ADR-0063). The repo is private: an Administrator
 * needs access to it; the server holds no GitHub token.
 */
export const EXTENSION_RELEASES_URL = "https://github.com/fnconsult/jobhub/releases?q=extension-v&expanded=true";

/** What an Administrator reads in Outils to load the latest extension unpacked, before the store review (#920). */
export interface ExtensionTestBuild {
  /** The Extension Version this deployment's commit carries. */
  extensionVersion: string;
  /** The API Version the server serves: an extension that states an older one than the one before is asked to update (proxy.ts). */
  apiVersion: number;
  /** The zip tied to this environment: the beta one on the Beta, the public one in Production (extension.yml). */
  zip: string;
  releasesUrl: string;
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
    releasesUrl: EXTENSION_RELEASES_URL,
  };
}
