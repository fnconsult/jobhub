import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { readLinkedInPage } from "../src/linkedin-page";

// Injected by the Side Panel's « Lire cette page LinkedIn » (ADR-0119, #1164), on the Candidate's click only, into the
// LinkedIn page in view: reads it in their own browser and gives back its Reading (each person's name, role and company,
// nothing else), or null. Never injected in the background.
export default defineUnlistedScript(() => readLinkedInPage(document));
