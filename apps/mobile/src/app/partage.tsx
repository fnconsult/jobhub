import { ShareCapture } from "../share/ShareCapture";

/**
 * The capture screen (Share capture, #697): the app's own address, which the share link opens (`shareLink`,
 * @jobhub/shared); the web has no such page. What was shared is held in memory (src/share/pending-share.ts), never read
 * from this address, so a sign-in in between finds it again.
 */
export default function SharePage() {
  return <ShareCapture />;
}
