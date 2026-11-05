import { usePathname } from "expo-router";
import { useSession } from "../session/SessionGate";
import { WebPage } from "./WebPage";

/**
 * The web app's page at `path` as a page of the signed-in app (#689): given the session's cookies, and the session read
 * again when the page lands where the web app sends a session it no longer knows (signed out, or the account deleted
 * there), which signs the app out once the web app has forgotten it.
 */
export function SessionWebPage({ path }: { path: string }) {
  const { webPages, recheck } = useSession();
  return <WebPage session={webPages} baseURL={webPages.baseURL} path={path} onSessionEnded={() => void recheck()} />;
}

/**
 * A screen of the app that is the web app's page at the same address (#689): `/compte/securite` shows the web's
 * `/compte/securite`, so the app's addresses stay the web's own (navigation/pages.ts).
 */
export function WebPageScreen() {
  return <SessionWebPage path={usePathname()} />;
}
