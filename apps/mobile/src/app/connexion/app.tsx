import { Redirect } from "expo-router";

/**
 * The magic link's address (#685), which the app claims by a universal link and an App Link: the session gate signs in
 * with it (src/session/SessionGate.tsx), and the app then opens on its home page.
 */
export default function SignInLink() {
  return <Redirect href="/" />;
}
