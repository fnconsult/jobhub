// The app shares the screen as iPadOS and Android expect of a tablet app (ADR-0076, #700): Split View, Slide Over and
// Stage Manager on iPad, split screen, free-form windows and foldables on Android. The shell lays itself out again from
// the window (src/shell/disposition.ts); this keeps the system from refusing to resize it, or from restarting it.
const { AndroidConfig, withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

/** iPad multitasking requires all four; iPhones keep `UISupportedInterfaceOrientations`, portrait (app.json). */
const IPAD_ORIENTATIONS = [
  "UIInterfaceOrientationPortrait",
  "UIInterfaceOrientationPortraitUpsideDown",
  "UIInterfaceOrientationLandscapeLeft",
  "UIInterfaceOrientationLandscapeRight",
];

/**
 * The changes the activity handles itself instead of being destroyed and created again: a rotation, a window resized in
 * split screen or free form, a foldable opened or closed (its smallest width changes), a keyboard plugged in, the theme.
 * React Native then gets the new window size and the shell lays itself out again, the conversation, its draft and its
 * scroll position untouched.
 */
const CONFIG_CHANGES = ["keyboard", "keyboardHidden", "orientation", "screenSize", "smallestScreenSize", "screenLayout", "uiMode"];

function setInfoPlist(infoPlist) {
  return { ...infoPlist, UIRequiresFullScreen: false, "UISupportedInterfaceOrientations~ipad": IPAD_ORIENTATIONS };
}

function setAndroidManifest(androidManifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  const declared = (activity.$["android:configChanges"] ?? "").split("|").filter(Boolean);
  activity.$["android:configChanges"] = [...new Set([...declared, ...CONFIG_CHANGES])].join("|");
  activity.$["android:resizeableActivity"] = "true";
  return androidManifest;
}

const withMultitasking = (config) => {
  config = withInfoPlist(config, (mod) => ({ ...mod, modResults: setInfoPlist(mod.modResults) }));
  return withAndroidManifest(config, (mod) => ({ ...mod, modResults: setAndroidManifest(mod.modResults) }));
};

module.exports = withMultitasking;
module.exports.setInfoPlist = setInfoPlist;
module.exports.setAndroidManifest = setAndroidManifest;
