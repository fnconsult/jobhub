import { Redirect } from "expo-router";

/**
 * A Sign-in Provider's return address (#687, APP_PROVIDER_RETURN_PATH), in the app's scheme: the system's authentication
 * browser closes on it and the session has already taken what it carries (src/session/app-session.ts). Android may also
 * hand it to the app as a deep link; the app then opens on its home page.
 */
export default function SignInProviderReturn() {
  return <Redirect href="/" />;
}
