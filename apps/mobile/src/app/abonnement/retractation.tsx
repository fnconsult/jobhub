import { useLocalSearchParams } from "expo-router";
import { paths } from "../../navigation/pages";
import { SessionWebPage } from "../../web-pages/WebPageScreen";

/**
 * « Renoncer au contrat ici » (#694, #511): the web's Withdrawal form of the contract named by `contrat` (a Coaching
 * Session's, from Mes coachs humains), in a WebView of the app (ADR-0076), with its query, which the page needs.
 */
export default function WithdrawalScreen() {
  const { contrat = "" } = useLocalSearchParams<{ contrat?: string }>();
  return <SessionWebPage path={paths.withdrawal(contrat)} />;
}
