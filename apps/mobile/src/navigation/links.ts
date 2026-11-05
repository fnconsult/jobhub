import { Linking, Share } from "react-native";
import type { RowAction } from "../ui/ObjectRow";
import { WEB_APP_URL } from "../web-app-url";

/**
 * `path`'s address on the web app the build talks to (src/web-app-url.ts), whose addresses are the app's (`paths`): it
 * opens the same page in a browser, or in the app by a universal link.
 */
export const webAddress = (path: string) => `${WEB_APP_URL}${path}`;

/** « Partager le lien »: the system's share sheet with the page's web address, to carry on on a computer, say. */
export const shareLinkAction = (label: string, path: string): RowAction => ({
  label,
  onPress: () => void Share.share({ url: webAddress(path), message: webAddress(path) }).catch(() => {}),
});

/** « Voir l'annonce »: a Job Offer's posting, on the site that published it, in the system's browser. */
export const openPostingAction = (label: string, url: string): RowAction => ({ label, onPress: () => void Linking.openURL(url).catch(() => {}) });
