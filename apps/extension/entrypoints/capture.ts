import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { readJobPage } from "../src/job-page";
import { snapshotPage } from "../src/page-snapshot";

// Injected by the popup's "Capturer cette page" into the active tab (activeTab):
// reads the page in the person's own browser and returns the Job Offer to capture.
export default defineUnlistedScript(() => readJobPage(snapshotPage(document)).jobOffer);
