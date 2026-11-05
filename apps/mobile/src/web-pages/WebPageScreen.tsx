import { usePathname } from "expo-router";
import { WebPage } from "./WebPage";

/**
 * A screen of the app that is the web app's page at the same address (#689): `/compte/securite` shows the web's
 * `/compte/securite`, so the app's addresses stay the web's own (navigation/pages.ts).
 */
export function WebPageScreen() {
  return <WebPage path={usePathname()} />;
}
