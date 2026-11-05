import { webPaths } from "../../navigation/pages";
import { WebPage } from "../../web-pages/WebPage";

/** Every section of Mon compte, the web's page listing them (`/compte` on the web), inside the app (#689). */
export default function AccountSections() {
  return <WebPage path={webPaths.accountSections} />;
}
