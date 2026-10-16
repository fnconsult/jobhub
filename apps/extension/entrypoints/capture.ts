import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { readJobPage } from "../src/job-page";
import { snapshotPage } from "../src/page-snapshot";

// Injected by the popup's "Capturer cette page" into every frame of the active tab it may read:
// reads each frame in the person's own browser; the popup keeps the one holding the posting (src/frame-choice.ts).
export default defineUnlistedScript(() => readJobPage(snapshotPage(document)));
