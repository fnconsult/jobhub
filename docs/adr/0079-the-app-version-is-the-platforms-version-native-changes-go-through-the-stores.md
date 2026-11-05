# The app's version is the platform's Version, native changes go through the stores, production goes out from a tag

_Builds on ADR-0076 (the native app) and ADR-0063 (Versions)._

- **One Version.** The Jobbbox app carries the platform's Version, read from the root `package.json` by `apps/mobile/app.config.ts`. EAS owns the build numbers (`appVersionSource: remote`, auto-increment), so no commit is needed to resubmit a build.
- **The runtime version is the native fingerprint.** An EAS Update reaches only Store builds with the same native code; any native change, a new module or a new permission, is a Store build and goes through store review. JavaScript-only fixes go out on the `staging` or `production` EAS Update channel.
- **EAS Update is off until the privacy policy names Expo.** Expo serves the updates from the United States and receives each install's `EAS-Client-ID` and IP address at every launch: a new recipient outside the EU, which ADR-0064 puts after a privacy policy version. The builds ship with `updates.enabled: false` (`apps/mobile/app.json`), a test refuses to switch it on before a version names Expo, and switching it on is a Store build. « Légal : » #762 also weighs an update server in the EU instead.
- **Production goes out from a Version tag `vX.Y.Z` only**, builds and updates alike, by the manual workflow `.github/workflows/mobile.yml`. Staging (TestFlight, Play internal) can run from any branch. As for the Beta, the product owner decides when to run it.
- **The app keeps its own store link** (Google Play by package, the App Store by its Apple ID in `app.json`), used by the Forced update, rather than reading one from Platform Settings. The server's `storeUrl`, when it names one, wins.
- **Store « Nouveautés » come from the Release Note** (title and the lead of each change, cut to Play's 500 characters) and are pasted by hand into App Store Connect and the Play Console until a key can write the listings.

## Considered Options

- **EAS Update on from the first build**: ships a recipient outside the EU before the privacy policy says so (ADR-0064).
- **A version of its own for the app**: two numbers to keep in step with the API Versions and the Release Notes.
- **A fixed runtime version, bumped by hand**: an update sent to a build whose native code differs crashes it; the fingerprint makes that impossible.
- **Production updates from `main`**: reaches Candidates before the Promotion (ADR-0063) and before the Release Note exists.
- **The store link in Platform Settings**: one more setting to keep right, for an address that changes once, when the app is created.
