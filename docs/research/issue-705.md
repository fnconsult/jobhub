# Research for issue #705: Maestro e2e for the mobile app

Scope: only the external facts needed to implement issue #705. Primary source reachable from the research session: the Maestro source repository (https://github.com/mobile-dev-inc/maestro, read through raw.githubusercontent.com, branch `main`, fetched 2026-11-06). `docs.maestro.dev`, Apple, Android and GitHub-runner docs were NOT reachable (network allowlist), so section 3 is an explicit list of unverified points.

## 1. Verified (from Maestro source)

- Scope of platforms. README: "Flows run on any emulator, simulator, browser, or physical Android device. Physical iOS devices are not yet supported." React Native is listed as supported, and the README says Expo supports Maestro as its preferred E2E platform (Maestro's own claim; check Expo docs before relying on it). So iOS = simulator only, which fits a CI-only floor.
- Screenshot comparison exists: `assertScreenshot` command (`maestro-orchestra/.../yaml/YamlAssertScreenshot.kt`, `YamlFluentCommand.kt`). Fields: `path` (reference image), `thresholdPercentage` (default `"95"`, i.e. 95 % similarity required), `cropOn` (an element selector, to compare one region), `label`, `optional` (default false). The short form is a bare path string. `takeScreenshot` also exists (`path`), usable to produce the references.
  - Implication: reference captures (AC 3) can be Maestro-native, but they are per device and per OS rendering; each (device, theme) pair needs its own reference file. Tune the threshold per screen; dynamic content (dates, avatars) should be avoided in the seeded stack or masked with `cropOn`.
  - Not verified: where relative `path` resolves (flow directory vs workspace), and how a mismatch artifact is reported. Confirm on first run.
- Orientation: `setOrientation` command exists with a `label` and `optional`. Valid values come from the `DeviceOrientation` enum, case insensitive, underscores optional (e.g. `landscape_left`). Exact enum list not retrieved (file path moved); read it from the installed CLI error message, which lists valid values.
- Other commands present in source: `setAirplaneMode`, `setPermissions`, `launchApp`, `clearState`, `travel`. Useful for offline and permission screens.

## 2. Not in Maestro's command set (as far as the source read shows)

The command list in `YamlFluentCommand.kt` (grepped) shows no command for system font scale, dark mode, Split View or fold state. Treat these as device-level settings done outside the flow:
- Dark/light: set on the simulator/emulator before the flow (`xcrun simctl ui <udid> appearance dark` on iOS; `adb shell cmd uimode night yes` on Android) or have the app honour a launch argument. Unverified commands: confirm against Apple/Android docs.
- Largest text size: `xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large` (iOS), `adb shell settings put system font_scale 2.0` (Android; the max slider value is device dependent). Unverified.
- iPad Split View (1/2) and Android foldable fold state: no Maestro command found. Likely needs either an app-level test hook, a resizable emulator profile (Android "Resizable"/"Pixel Fold" AVD, `adb emu fold`/`unfold`), or a manual-verified list for iPad Split View. This is the main risk for AC 2.

## 3. Unverified, to check before building the CI job

1. GitHub-hosted runners: macOS runner needed for iOS simulators (cost, minutes multiplier), Linux with KVM for Android emulator (`reactivecircus/android-emulator-runner`). Check runner docs and pricing.
2. iPad / iPhone SE simulator runtimes available on the chosen macOS runner image.
3. Whether an Expo SDK 58 / RN 0.88 build can be produced for simulator in CI without EAS (a local `expo run:ios --no-install` or an EAS `simulator: true` profile in `apps/mobile/eas.json`); the current `mobile.yml` only runs EAS for staging/production.
4. Maestro accessibility checks: the source read found no accessibility audit command. Plan for the "list verified in the PR" fallback of AC 4 unless Maestro docs show otherwise; `assertVisible` by accessibility label/text can check labels exist.
5. Maestro CLI install method and version pin (Java required); pick an exact version from the releases page.
6. Maestro Cloud / telemetry: the CLI has analytics (`maestro.cli.analytics`); check the opt-out (`--analyze`/`MAESTRO_CLI_NO_ANALYTICS`) for the privacy register. Unverified.

## 4. Implementation consequences

- Use Maestro locally in CI (open source, Apache 2.0 per file headers), no Maestro Cloud, so no personal data leaves the seeded test stack.
- One workflow job, path-filtered on `apps/mobile/**` and `packages/shared/**`; split iOS and Android jobs.
- Seeded test stack and `assertScreenshot` references per (device, theme); document redraw procedure in `docs/ops/mobile.md`.
