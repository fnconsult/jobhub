// The system's passkeys (#688), the only code that calls them: the iOS Keychain's through AuthenticationServices and
// Android's Credential Manager, by react-native-passkey. A passkey of the site (jobbbox.ai, or the Beta's host) is offered
// because the app is associated with it (`webcredentials` in app.json, `get_login_creds` in the site's assetlinks.json).
// Nothing is kept: the system's answer goes to the web app's second step, which checks it.
import { Passkey, type PasskeyGetRequest } from "react-native-passkey";
import type { DevicePasskeys } from "./app-session";

export const devicePasskeys: DevicePasskeys = {
  supported: () => {
    try {
      return Passkey.isSupported();
    } catch {
      return false;
    }
  },
  // A sheet dismissed, or no passkey of the site on the device, rejects: the second step then says it was not used.
  sign: (request) => Passkey.get(request as PasskeyGetRequest),
};
