// Share capture's native side (#697, ADR-0076), as prebuild and the stores read it: the iOS share extension added by
// plugins/with-share-extension.js, and the Android share intent of modules/share-intent. Both open the app with the
// share link (`shareLink`, @jobhub/shared), which the app reads back.
import { readShareLink } from "@jobhub/shared";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MOBILE = join(__dirname, "..");
const read = (...path: string[]) => readFileSync(join(MOBILE, ...path), "utf8");
const expo = JSON.parse(read("app.json")).expo;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../plugins/with-share-extension");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const xcode = require("xcode");

/** An Xcode project as `xcode` parses one: a real one from the dependencies, whose first target stands for the app. */
function xcodeProject() {
  const folder = dirname(require.resolve("@react-native-async-storage/async-storage/package.json"));
  return xcode.project(join(folder, "ios", "RNCAsyncStorage.xcodeproj", "project.pbxproj")).parseSync();
}

describe("the iOS share extension", () => {
  it("is added by the app's config plugin", () => {
    expect(expo.plugins).toContain("./plugins/with-share-extension");
  });

  it("is offered for one web link or a text, by its own controller, with no screen of its own", () => {
    const info = plugin.shareExtensionInfoPlist();
    expect(info.NSExtension).toEqual({
      NSExtensionAttributes: { NSExtensionActivationRule: { NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsText: true } },
      NSExtensionPointIdentifier: "com.apple.share-services",
      NSExtensionPrincipalClass: "$(PRODUCT_MODULE_NAME).ShareViewController",
    });
    expect(info.CFBundleDisplayName).toBe("Jobbbox");
    expect(plugin.plist(info)).toContain("<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>\n\t\t\t\t<integer>1</integer>");
  });

  it("opens the app on the share link, its link and text, a « + » kept, and calls nothing else", () => {
    const swift: string = plugin.SHARE_VIEW_CONTROLLER;
    expect(swift).toContain('components.scheme = "jobbbox"');
    expect(swift).toContain('components.host = "partage"');
    expect(swift).toContain('URLQueryItem(name: "url"');
    expect(swift).toContain('URLQueryItem(name: "text"');
    expect(swift).toContain('replacingOccurrences(of: "+", with: "%2B")');
    expect(swift).not.toMatch(/URLSession|UserDefaults|Keychain|WKWebView/);
    expect(readShareLink("jobbbox://partage?url=https://exemple.fr/offre?id%3D1&text=C%2B%2B%20senior")).toEqual({ url: "https://exemple.fr/offre?id=1", text: "C++ senior" });
  });

  it("is its own target in the Xcode project, embedded in the app, on the app's iOS and devices, and added once", () => {
    const project = plugin.addShareExtension(xcodeProject(), "1.4.0");
    plugin.addShareExtension(project, "1.4.0");

    const targets = Object.values(project.pbxNativeTargetSection()).filter((each: unknown) => String((each as { name?: string }).name).replace(/"/g, "") === "JobbboxShare");
    expect(targets).toHaveLength(1);
    const settings = Object.values(project.pbxXCBuildConfigurationSection())
      .map((each) => (each as { buildSettings?: Record<string, string> }).buildSettings)
      .filter((each) => each?.PRODUCT_BUNDLE_IDENTIFIER === "ai.jobbbox.app.share");
    expect(settings).toHaveLength(2);
    for (const each of settings) expect(each).toMatchObject({ IPHONEOS_DEPLOYMENT_TARGET: "16.4", TARGETED_DEVICE_FAMILY: '"1,2"', INFOPLIST_FILE: "JobbboxShare/Info.plist", MARKETING_VERSION: "1.4.0", APPLICATION_EXTENSION_API_ONLY: "YES" });
    // Copied into the app's PlugIns folder (subfolder 13), once.
    const plugIns = Object.values(project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}).filter((each: unknown) => (each as { dstSubfolderSpec?: number }).dstSubfolderSpec === 13);
    expect(plugIns).toEqual([expect.objectContaining({ files: [expect.objectContaining({ comment: "JobbboxShare.appex in Copy Files" })] })]);
    expect(project.writeSync()).toContain("JobbboxShare.appex");
  });

  it("is signed by EAS with the app, once", () => {
    const config = plugin.withAppExtension(plugin.withAppExtension({ name: "Jobbbox", slug: "jobbbox", extra: { eas: { projectId: "p1" } } }));
    expect(config.extra.eas).toEqual({
      projectId: "p1",
      build: { experimental: { ios: { appExtensions: [{ targetName: "JobbboxShare", bundleIdentifier: "ai.jobbbox.app.share", entitlements: {} }] } } },
    });
  });
});

describe("the Android share intent", () => {
  const manifest = read("modules", "share-intent", "android", "src", "main", "AndroidManifest.xml");
  const activity = read("modules", "share-intent", "android", "src", "main", "java", "ai", "jobbbox", "shareintent", "ShareReceiverActivity.kt");

  it("receives a text shared (a link, a sentence and a link, a posting's text), never any type", () => {
    expect(manifest).toContain('<action android:name="android.intent.action.SEND" />');
    expect(manifest).toContain('<category android:name="android.intent.category.DEFAULT" />');
    expect(manifest).toContain('<data android:mimeType="text/plain" />');
    expect(manifest).not.toContain('android:mimeType="*/*"');
    expect(manifest).toContain('android:exported="true"');
  });

  it("opens the app on the share link, in the app's package, and keeps nothing", () => {
    expect(activity).toContain('Uri.Builder().scheme(SCHEME).authority(SHARE_HOST).appendQueryParameter("text"');
    expect(activity).toContain('private const val SCHEME = "jobbbox"');
    expect(activity).toContain('private const val SHARE_HOST = "partage"');
    expect(activity).toContain("setPackage(packageName)");
    expect(activity).not.toMatch(/SharedPreferences|HttpURLConnection|WebView/);
    // As Android's Uri.Builder encodes the text: every reserved character, spaces as %20.
    expect(readShareLink("jobbbox://partage?text=D%C3%A9couvrez%20cette%20offre%20https%3A%2F%2Fwww.linkedin.com%2Fjobs%2Fview%2F1")).toEqual({
      text: "Découvrez cette offre https://www.linkedin.com/jobs/view/1",
    });
  });

  it("is a local Expo module for Android, linked as the app's others are", () => {
    expect(JSON.parse(read("modules", "share-intent", "expo-module.config.json")).platforms).toEqual(["android"]);
  });
});
