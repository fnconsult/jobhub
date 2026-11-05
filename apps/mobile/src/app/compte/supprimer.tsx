import { webPaths } from "../../navigation/pages";
import { SessionWebPage } from "../../web-pages/WebPageScreen";

/**
 * Account deletion (ADR-0010), the web's own flow inside the app, opened on it (Mes données, « Supprimer mon compte »):
 * three gestures from anywhere, Menu, Mon compte, then this (App Store guideline 5.1.1(v), #689).
 */
export default function AccountDeletion() {
  return <SessionWebPage path={webPaths.accountDeletion} />;
}
