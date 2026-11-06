// Share capture on iOS and iPadOS (#697, ADR-0076): « Partager → Jobbbox » from Safari, LinkedIn, Indeed or Mail. A share
// extension, its own target in the Xcode project that prebuild generates, takes the web link and the text the person
// shares (one link at most, any text) and opens the app with the share link (`shareLink` in @jobhub/shared): the
// capture screen, where the person checks it before sending it to the web app, which reads the link itself. The
// extension calls no API and holds no session (the app's session stays in the app's Keychain), keeps nothing, shows no
// screen of its own and needs no App Group: what was shared travels in the link alone.
// EAS signs the extension with the app (`extra.eas.build.experimental.ios.appExtensions`), under the bundle identifier
// SHARE_EXTENSION_BUNDLE_ID, which the Apple Developer account must hold (docs/ops/mobile.md).
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const TARGET = "JobbboxShare";
const SHARE_EXTENSION_BUNDLE_ID = "ai.jobbbox.app.share";
/** As the app's (app.json `ios.deploymentTarget`, ADR-0076). */
const DEPLOYMENT_TARGET = "16.4";
/** The share link's address, `jobbbox://partage` (APP_SCHEME and SHARE_PATH in @jobhub/shared). */
const SCHEME = "jobbbox";
const SHARE_HOST = "partage";
/** As much text as the web app takes (MAX_SHARED_TEXT_CHARS). */
const MAX_TEXT = 100000;

/** The extension's Info.plist: one web link at most, or text, from the share sheet; no storyboard, its own controller. */
function shareExtensionInfoPlist() {
  return {
    CFBundleDevelopmentRegion: "fr",
    CFBundleDisplayName: "Jobbbox",
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundlePackageType: "XPC!",
    CFBundleShortVersionString: "$(MARKETING_VERSION)",
    CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
    NSExtension: {
      NSExtensionAttributes: {
        NSExtensionActivationRule: { NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsText: true },
      },
      NSExtensionPointIdentifier: "com.apple.share-services",
      NSExtensionPrincipalClass: "$(PRODUCT_MODULE_NAME).ShareViewController",
    },
  };
}

/** The extension's controller: reads what was shared, opens the app on the share link, and ends at once. */
const SHARE_VIEW_CONTROLLER = `import UIKit
import UniformTypeIdentifiers

/// Jobbbox's share extension (#697): the web link and the text shared become the share link
/// (${SCHEME}://${SHARE_HOST}?url=…&text=…), which opens the app's capture screen. Nothing is read from the page, nothing
/// is sent anywhere, nothing is kept.
@objc(ShareViewController)
final class ShareViewController: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Task { @MainActor in
      if let link = await self.shareLink() { self.openApp(link) }
      self.extensionContext?.completeRequest(returningItems: nil)
    }
  }

  /// The share link of what was shared: its first web link and its first text, or nil when there is neither.
  private func shareLink() async -> URL? {
    var url: URL?
    var text: String?
    for item in extensionContext?.inputItems as? [NSExtensionItem] ?? [] {
      for provider in item.attachments ?? [] {
        if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
          let found = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
          ["http", "https"].contains(found.scheme?.lowercased() ?? "")
        {
          url = found
        } else if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
          let found = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String
        {
          text = found
        }
      }
      if text == nil, let content = item.attributedContentText?.string, !content.isEmpty { text = content }
    }
    var components = URLComponents()
    components.scheme = "${SCHEME}"
    components.host = "${SHARE_HOST}"
    components.queryItems = [
      url.map { URLQueryItem(name: "url", value: $0.absoluteString) },
      text.map { URLQueryItem(name: "text", value: String($0.prefix(${MAX_TEXT}))) },
    ].compactMap { $0 }
    guard !(components.queryItems ?? []).isEmpty else { return nil }
    // A "+" is a space to the app's URLSearchParams: written as %2B, as every other reserved character is.
    components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
    return components.url
  }

  /// An extension has no UIApplication.shared: the responder chain reaches the application that hosts it.
  private func openApp(_ link: URL) {
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        application.open(link, options: [:], completionHandler: nil)
        return
      }
      responder = current.next
    }
  }
}
`;

/** A plist of `value`, as Xcode writes one. */
function plist(value) {
  const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const write = (node, indent) => {
    const pad = "\t".repeat(indent);
    if (typeof node === "boolean") return `${pad}<${node}/>`;
    if (typeof node === "number") return `${pad}<integer>${node}</integer>`;
    if (typeof node === "string") return `${pad}<string>${escape(node)}</string>`;
    const entries = Object.entries(node).map(([key, child]) => `${pad}\t<key>${escape(key)}</key>\n${write(child, indent + 1)}`);
    return `${pad}<dict>\n${entries.join("\n")}\n${pad}</dict>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${write(value, 0)}\n</plist>\n`;
}

/** The build settings of the extension's target, for both of its configurations. */
function buildSettings(version) {
  return {
    PRODUCT_BUNDLE_IDENTIFIER: SHARE_EXTENSION_BUNDLE_ID,
    PRODUCT_NAME: `"${TARGET}"`,
    INFOPLIST_FILE: `${TARGET}/Info.plist`,
    IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
    TARGETED_DEVICE_FAMILY: `"1,2"`,
    SWIFT_VERSION: "5.0",
    MARKETING_VERSION: version,
    CURRENT_PROJECT_VERSION: "1",
    CODE_SIGN_STYLE: "Automatic",
    SKIP_INSTALL: "YES",
    APPLICATION_EXTENSION_API_ONLY: "YES",
    LD_RUNPATH_SEARCH_PATHS: `"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"`,
  };
}

/**
 * Adds the extension's target to the Xcode `project` (the `xcode` package's), embedded in the app; nothing when it is
 * there already, so prebuild may run again.
 */
function addShareExtension(project, version) {
  // Names are written quoted in the project: "JobbboxShare".
  const targets = Object.values(project.pbxNativeTargetSection()).filter((each) => typeof each === "object");
  if (targets.some((each) => String(each.name).replace(/"/g, "") === TARGET)) return project;
  const app = project.getFirstTarget();
  const target = project.addTarget(TARGET, "app_extension", TARGET, SHARE_EXTENSION_BUNDLE_ID);
  // Built before the app that embeds it ("Copy Files" into its PlugIns, which `addTarget` adds).
  project.addTargetDependency(app.uuid, [target.uuid]);
  const group = project.addPbxGroup(["ShareViewController.swift", "Info.plist"], TARGET, TARGET);
  project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
  project.addBuildPhase(["ShareViewController.swift"], "PBXSourcesBuildPhase", "Sources", target.uuid);
  project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
  const configurations = project.pbxXCBuildConfigurationSection();
  const listId = project.pbxNativeTargetSection()[target.uuid].buildConfigurationList;
  const list = project.pbxXCConfigurationList()[listId];
  for (const { value } of list.buildConfigurations) Object.assign(configurations[value].buildSettings, buildSettings(version));
  return project;
}

/** What EAS Build is told of the extension, to sign it with the app. */
function withAppExtension(config) {
  const eas = config.extra?.eas ?? {};
  const experimental = eas.build?.experimental ?? {};
  const known = experimental.ios?.appExtensions ?? [];
  const appExtensions = known.some((each) => each.targetName === TARGET) ? known : [...known, { targetName: TARGET, bundleIdentifier: SHARE_EXTENSION_BUNDLE_ID, entitlements: {} }];
  return { ...config, extra: { ...config.extra, eas: { ...eas, build: { ...eas.build, experimental: { ...experimental, ios: { ...experimental.ios, appExtensions } } } } } };
}

const withShareExtension = (config) => {
  config = withAppExtension(config);
  config = withDangerousMod(config, [
    "ios",
    (mod) => {
      const folder = join(mod.modRequest.platformProjectRoot, TARGET);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "ShareViewController.swift"), SHARE_VIEW_CONTROLLER);
      writeFileSync(join(folder, "Info.plist"), plist(shareExtensionInfoPlist()));
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => ({ ...mod, modResults: addShareExtension(mod.modResults, config.version ?? "1.0.0") }));
};

module.exports = withShareExtension;
Object.assign(module.exports, { TARGET, SHARE_EXTENSION_BUNDLE_ID, shareExtensionInfoPlist, SHARE_VIEW_CONTROLLER, plist, addShareExtension, withAppExtension });
