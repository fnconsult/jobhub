import Constants from "expo-constants";
import { Linking, Share } from "react-native";
import type { RowAction } from "../ui/ObjectRow";

/** The web app the app is a companion of (app.json's `extra.webOrigin`): its addresses are the app's (`paths`). */
const WEB_ORIGIN: string = Constants.expoConfig?.extra?.webOrigin ?? "https://jobbbox.ai";

/** `path`'s address on the web, which opens the same page in a browser, or in the app by a universal link. */
export const webAddress = (path: string) => `${WEB_ORIGIN}${path}`;

/** « Partager le lien »: the system's share sheet with the page's web address, to carry on on a computer, say. */
export const shareLinkAction = (label: string, path: string): RowAction => ({
  label,
  onPress: () => void Share.share({ url: webAddress(path), message: webAddress(path) }).catch(() => {}),
});

/** « Voir l'annonce »: a Job Offer's posting, on the site that published it, in the system's browser. */
export const openPostingAction = (label: string, url: string): RowAction => ({ label, onPress: () => void Linking.openURL(url).catch(() => {}) });
