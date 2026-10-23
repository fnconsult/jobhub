# Research for issue #318: does the session pane meet AI Act art. 50, and what else is owed

Checked 2026-10-23 on branch `ai-provenance-map` (`084fbf61`), against the AI Act, the Commission's final art. 50 guidelines (20 July 2026), the Code of Practice on transparency of AI-generated content (10 June 2026), GDPR, the Code de la consommation and each brand's own pages. **This is not legal advice.** Points that need a lawyer are marked **Counsel** and listed at the end. The Code's PDF could not be read as text (its font is encoded), so claims about the Code come from the Commission's web pages, not from the Code itself.

Short answer: the pane is useful, but it is **extra**. It does not discharge art. 50 by itself. Two duties are owed elsewhere:
- a visible, plain-language « this is an AI » disclosure in the Coach, at the start of each conversation;
- machine-readable marking of generated text (art. 50(2)), which a human-readable pane cannot provide.

Neither the privacy notice nor the legal page exists yet. Both are owed whatever the pane does.

## Sources

- AI Act, Regulation (EU) 2024/1689: https://eur-lex.europa.eu/eli/reg/2024/1689/oj. EUR-Lex returned an empty page to our fetcher. Article wording was read on https://artificialintelligenceact.eu/article/50/ and https://artificialintelligenceact.eu/annex/3/ (secondary sources that mirror the Official Journal) and should be checked against EUR-Lex.
- Commission, *Guidelines on the implementation of the transparency obligations for certain AI systems under Article 50*, annex to C(2026) 5054 final, 20 July 2026: https://ec.europa.eu/newsroom/dae/redirection/document/131215. Library page: https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems. Cited below as "Guidelines (n)", where n is the paragraph.
- Code of Practice on marking and labelling of AI-generated content: https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content. Published: https://digital-strategy.ec.europa.eu/en/news/commission-publishes-code-practice-marking-and-labelling-ai-generated-content. Signatories: https://digital-strategy.ec.europa.eu/en/news/strong-backing-code-practice-transparency-ai-generated-content. EU icons: https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content
- Draft Commission guidelines on the classification of high-risk AI systems (19 May 2026): https://digital-strategy.ec.europa.eu/en/library/draft-commission-guidelines-classification-high-risk-ai-systems. Employment examples: https://ai-act-service-desk.ec.europa.eu/en/employment-0
- GDPR, Regulation (EU) 2016/679: https://eur-lex.europa.eu/eli/reg/2016/679/oj. CJEU C-154/21 *Österreichische Post* (12 Jan 2023): https://curia.europa.eu/juris/liste.jsf?num=C-154/21. CJEU C-582/14 *Breyer*: https://curia.europa.eu/juris/liste.jsf?num=C-582/14
- CNIL, « IA : Informer les personnes concernées »: https://www.cnil.fr/fr/ia-informer-les-personnes-concernees
- Code de la consommation art. L121-2: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563114
- Trade Mark Directive (EU) 2015/2436, art. 14: https://eur-lex.europa.eu/eli/dir/2015/2436/oj. CJEU C-228/03 *Gillette*: https://curia.europa.eu/juris/liste.jsf?num=C-228/03
- Brand pages: cited in §7.

## 1. Provider, deployer, or both

**Definitions.**
- A *provider* develops an AI system, or has one developed, and places it on the market or puts it into service "under its own name or trademark", paid or free (art. 3(3)).
- A *deployer* uses an AI system "under its authority", unless the use is for a personal, non-professional activity (art. 3(4)).

The Guidelines give a direct example (11): a company that offers a chatbot or generative application "on the Union market under its own name or trademark" to consumers is the provider, whether it charges or not. Building on a third-party model does not change that. Art. 50 applies to systems built on GPAI models, and the model vendor's own duties are separate (26–27). One operator can hold both roles (15).

| Feature | Jobbbox's role | Duty that follows |
|---|---|---|
| (a) Generated text: Tailored CV and Cover Letter, Company Dossier, offer summaries, Action Cards | **Provider** of a generative system, under the Jobbbox name (Guidelines 11) | **50(2)**: machine-readable marking and detectability of the output. **50(4)** does not apply (see below). |
| (b) AI Coach, and the Back Office Assistant | **Provider** of an interactive system | **50(1)**: inform the person that they are interacting with AI, unless that is obvious (§3) |
| (c) Match Score and the ranking of Job Offers | Mostly rules, not an AI system. AI only extracts missing fields from the offer. | **No art. 50 duty**: ranking existing content and extracting data without summarising it are outside 50(2) (Guidelines 65) |

**Why 50(4) does not apply.**
- Art. 50(4), second subparagraph, binds *deployers* of text "published with the purpose of informing the public on matters of public interest".
- Text shown only to the Candidate who asked for it is not "published". The Guidelines give this exact case as out of scope: a "news summary generated by a chatbot that is only available to the user that prompted the chatbot" (131).
- Is the Candidate a deployer when sending their own CV? Probably not: a job search is arguably a personal, non-professional activity (art. 3(4); Guidelines 2.4.1). **Counsel.**

**Is the Match Score high-risk under Annex III point 4?**
- Point 4(a) covers systems "intended to be used for the recruitment or selection of natural persons", including placing "targeted job advertisements".
- The Commission's *draft* classification guidelines put two candidate-side tools out of scope:
  - a CV-tailoring tool, because "its use is initiated and managed by the candidate, outside of the potential employer's control";
  - a tool that ranks vacancies for a candidate, because "these recommendations are exclusively shared with the candidate".
- The same draft puts in scope an *employment agency* that suggests postings to jobseekers and refers candidates to employers (https://ai-act-service-desk.ec.europa.eu/en/employment-0).
- Jobbbox matches the out-of-scope case today. It would move toward high-risk if it ever ranked or referred Candidates *to employers*, for example in B2B outplacement (ADR-0004).
- Annex III duties apply from 2 Dec 2027 under the AI Omnibus. The final guidelines are expected by the end of 2026 (Commission library page above). **Counsel** to confirm once they are final.

**When the duties start.**
- Art. 50 applies from 2 Aug 2026 (Guidelines 153).
- The AI Omnibus gives generative systems already on the market before that date until **2 Dec 2026** for 50(2) marking only. The 50(1) disclosure was due on 2 Aug 2026 with no transition (Guidelines 153).
- Outputs generated before 2 Aug 2026 need no marking after the fact (154).

## 2. The Commission guidance as of October 2026

**Status of each document.**
- **Guidelines.** Final content approved 20 July 2026 (C(2026) 5054). The annex is titled "Approval of the content of the draft Communication", so formal adoption may follow once every language version exists. They are non-binding and are "a first interpretation" (155).
- **Code of Practice.**
  - Published 10 June 2026. Voluntary.
  - Assessed as adequate by the Commission and the AI Board (signatories page).
  - Section 1 covers providers (marking and detection). Section 2 covers deployers (labelling deep fakes and public-interest text).
  - **Anthropic and Mistral** are named as Section 1 signatories. Perplexity and AWS are not (signatories page, updated 24 Sep 2026).
- **CNIL.** No CNIL guidance on wording or placement for AI-generated text or chatbots was found. Its AI fact sheets cover GDPR information duties, mainly for training data, and recommend information given in layers (fiche cited above).

**Mark each item, or the service once?**
- **50(1), interaction**: "at least, be provided once at the start of an interactive session" (Guidelines 143).
- **50(2) and (4), content**: the duty "applies to each output of an AI system" (Guidelines 143).
- For 50(2), what the person must be able to get is the *detection result* for a given piece of content (77). The duty is a machine-readable mark plus a detection means (69–70), not a visible label.
- Visible labels "are not excluded as a complementary measure" (71).
- One mark for the whole service is not enough for 50(1). A generic line such as « Services on this website use AI » "is insufficient" (38).

**Wording and placement.**
- Information must be "clear and distinguishable": noticeable, easy to understand, accessible, and separate from its surroundings. It fails if it sits only in a manual, under layers of menus, or in terms of use (142).
- The Guidelines recommend:
  - a plain-language banner or first-turn greeting;
  - optionally a persistent badge;
  - placement "close to the interaction interface (e.g. near the input/output field)" (37).
- The EU icons are optional and meant for deployers' 50(4) labels (EU icons page). They do not fit Jobbbox's case, since 50(4) does not apply (§1).

**What text marking requires.**
- The Guidelines' list of things that need marking includes "AI-generated summaries of text" and rewriting that changes "style, structure and meaning" (92). That covers offer summaries, Tailored Documents and the Company Dossier.
- Outside 50(2):
  - grammar fixes, spell-checking and translation (92);
  - very short outputs: "single words, image captions, alt-text, UI labels" (68). That likely covers job title variants and Action Card titles, but not their bodies.
- A provider "may rely on the marking solution implemented by an upstream model provider", but must still be able to show that it complies (74).
- Whether Bedrock-served Claude, Mistral or Perplexity responses carry any text mark is **unverified**. Ask each vendor (§Recommendation).

## 3. The Coach without a visible author

- Art. 50(1) exempts only a case that is "obvious from the point of view of a natural person who is reasonably well-informed, observant and circumspect".
- The Guidelines read this exception "restrictively" (45). Where elderly people, people with disabilities or people with lower literacy are in the audience, the expected level of awareness is *lower* (44). A UI that suggests a human lowers obviousness (45).
- Three facts weigh against "obvious" for Jobbbox:
  - the audience is 40+ and in a stressful job search;
  - the product sells **Human Coaches** (`/coachs`) next to the « Mon coach » AI Coach;
  - #317 removed the only visible author label. "Coach" alone is close to the "generic references to 'assistant'" that the Guidelines call insufficient (38).
- **Per reply or once?** "A single, prominent notification before the first interaction … is likely to suffice in most instances" (40). Periodic reminders are "likely to be necessary" in riskier contexts, which include the elderly and those with lower literacy, and emotional distress (40). The system must also answer truthfully whenever it is asked whether it is an AI (40).
- **Is the model-id line enough?** Probably not. A raw model id such as `anthropic.claude-opus-5` is a "technical or capability-based description". On its own, one like "this system uses LLMs" is insufficient (38). It is also metadata at 0.8125rem (ADR-0009 amendment), so it is easy to overlook (142).
- **Recommendation.**
  - (i) A first-turn disclosure in every new Coach Conversation, in plain words, for example « Je suis le coach IA de Jobbbox : un programme d'intelligence artificielle, pas une personne. Pour parler à un coach humain, voir Coachs. »
  - (ii) A persistent visible badge « Coach IA » in the Coach Panel header, near the input.
  - (iii) The model line stays as a complement.
  - (iv) The Coach Playbook instructs the model to say it is an AI whenever asked.
  - The same applies to the Back Office Assistant. Its professional audience makes "obvious" easier to argue (44), but a one-line notice costs nothing.
  - Exact wording goes to #320. **Counsel** on whether the 40+ audience calls for periodic reminders.

## 4. GDPR art. 13–14, and the register

- Art. 13(1)(e) requires the "recipients or categories of recipients", and 13(1)(f) any transfer to a third country with its safeguards.
- Under art. 15(1)(c), the CJEU holds that the controller must give the *identity* of the recipients on request (C-154/21). Naming the processors in the notice from the start is the safe reading.
- CNIL recommends information given in layers, with the essentials first (fiche cited above).
- **Gaps in `docs/privacy/register.md` today:**
  - The header says "no transfer outside the EU". The ADR-0007 amendment of 2026-10-20 allows non-EU text routes, such as Claude's direct API and OpenAI without EU residency, and treats the web-search providers as outside the EU. The register itself says such a transfer "belongs in the register". **These conflict.**
  - Processors are named only for the Back Office Assistant. There is no entry for the Candidate-side processing behind the pane: AI Coach and Coach Conversations, Tailored Documents, Company Dossier, Job discovery (web search), Master CV parsing, EU AI Consent routing to Mistral. Each needs its processors: AWS (Bedrock), Mistral, Perplexity / Brave / Tavily / Linkup, Fantastic.jobs, France Travail.
  - Does Anthropic itself receive data when Claude runs on Bedrock, or only AWS? That decides who the processor is. **Counsel**, with the AWS and Anthropic terms.
- **Is there a duty to keep the pane and the notice consistent?** No article says so in those words. But naming a provider in the pane that the notice leaves out makes the information unfair and non-transparent (art. 5(1)(a), art. 12(1)). It also makes the notice incomplete. Generate both lists from one catalogue, the provider and Tool list in `packages/shared`. That way a provider added in Paramètres (ADR-0033) cannot appear in the pane before it is in the notice.

## 5. A downloaded Tailored CV or Cover Letter sent to an employer

- **50(4).** It does not apply. The text is private correspondence, not "published" (131). The Candidate sends it, probably as a personal, non-professional activity.
- **50(2).** It applies to Jobbbox as the provider. The marking duty attaches to "each output", and a tailored CV is a substantive rewrite (92). The mark is machine-readable, not a visible label: for example the DOCX/PDF metadata (author or producer « Jobbbox (IA) ») or a C2PA manifest if one becomes available for documents. The Guidelines accept simpler metadata only in narrow cases (86). **Counsel** on what counts as "state of the art" for text documents. The 2 Dec 2026 transition may apply (§1).
- **A visible label on the CV.** It is not required by art. 50 and is a product choice. A visible « rédigé par IA » would hurt the Candidate. ADR-0006 (facts only from the Master CV) and the Candidate's review argue for leaving it off.
- Exported documents are out of the map's scope (#314). Flag this as a separate issue.

## 6. « En savoir plus » and a legal page

- The art. 50 disclosure must be in context. A legal page can only complement it, never replace it (Guidelines 38, 142). So the pane does not *need* the link to comply.
- A legal page is owed anyway, for other reasons:
  - GDPR art. 12–13: a privacy notice easy to find;
  - French law: mentions légales under the LCEN (loi n° 2004-575, https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000801164; the article number after the 2024 SREN law needs **Counsel**);
  - pre-contract information and terms for paid Plans (Code de la consommation L111-1, L221-5).
- **Recommendation.** Add an « IA dans Jobbbox » section to the future privacy and legal page. It should say which features use AI, which providers, where they run, the EU AI Consent, and that the Match Score and ATS Score are rule-based. Link it from the pane's foot and from the Coach's first-turn disclosure.

## 7. Logos

| Brand | What its own page says | Source |
|---|---|---|
| Anthropic | "You may only use our trademarks as specifically permitted by us and only in materials we approve beforehand". No use that implies sponsorship, endorsement or affiliation. | https://www.anthropic.com/legal/trademark-guidelines |
| AWS | Fair use is "in plain text only (no logos)" and may not imply affiliation, sponsorship or endorsement. The "Powered by AWS" logo is licensed to customers but "never" to indicate affiliation, nor combined with your own marks. | https://aws.amazon.com/trademark-guidelines/ |
| Mistral | "Partners and collaborators are welcome to use our brand" with care. Kit and misuse rules: no recolouring, frame, coloured background or old versions. Silent on endorsement and on whether an API customer counts as a "partner". | https://mistral.ai/brand |
| Perplexity | Brand guidelines exist (linked from perplexity.ai's footer) but did not render for our fetcher. **Unverified.** | https://live.standards.site/perplexity/ |
| France Travail | No public logo terms found. API terms are on francetravail.io (not readable here). `docs/research/job-sources.md` already plans to request access "with attribution". **Unverified.** | https://francetravail.io |
| Fantastic.jobs | Terms silent on attribution and logos (`docs/research/issue-243.md`). | https://developer.fantastic.jobs/terms |
| Annuaire des entreprises (State, DINUM) | The Marianne block is the State brand's invariant and "ne peut être utilisé que dans ce cadre". The Marianne typeface is reserved for the State. | https://www.info.gouv.fr/marque-de-letat/le-bloc-marque |

**Does a logo next to a model id imply endorsement?**
- Referring to another's mark is lawful only "for the purpose of identifying or referring to" their goods "in accordance with honest practices" (Directive 2015/2436 art. 14(1)(c), 14(2)).
- That use must not give the impression of a commercial connection (*Gillette*, C-228/03).
- A plain-text name such as « Claude (Anthropic), via AWS Bedrock » is the textbook case of referring use.
- A row of vendor logos in a product's own UI reads closer to "powered by" or partnership branding. AWS and Anthropic expressly forbid that without permission.

**Recommendation.**
- **Text names only.** Show the provider and model name in text.
- Use Jobbbox's own neutral activity glyphs (already designed, #315) instead of vendor logos.
- Never show the Marianne or the State block. Write « Annuaire des entreprises (data.gouv.fr) » in text.
- Add logos later, brand by brand, only with written permission (Anthropic: marketing@anthropic.com; AWS: trademarks@amazon.com) and within each kit's rules.

## 8. Tokens and time next to Plan Quotas

- A commercial practice is misleading if it is likely to mislead about "le prix ou le mode de calcul du prix" or the service's essential characteristics (L121-2 2° b–c, transposing Directive 2005/29).
- Plan Quotas count actions per week (ADR-0032, CONTEXT « Plan Quota »), never tokens.
- Showing token counts beside the Usage Meter, with no unit word (#314 dropped « tokens »), invites the reading "I am spending k-units of my allowance". This matters most on Free, where the Candidate may think tokens run out. A stopped action that shows tokens spent but counts no quota (#316) adds to the confusion.

**Safeguards.**
- Keep tokens out of the Usage Meter, `/abonnement` and every Upgrade Prompt.
- Never show a currency or cost (already out of scope).
- Label the Modèles section once: « Mesure technique de l'IA : n'est pas décomptée de vos quotas ».
- Keep a unit on hover or for screen readers (« 2,1 k jetons »).
- State in the « IA dans Jobbbox » text that quotas count actions.
- **Counsel** if a Plan is ever priced or capped in tokens.

## 9. Favicons from third parties

- Confirmed: loading `/favicon.ico` from each site in the Candidate's browser sends their IP address, user agent and timing to that site.
- A dynamic IP address can be personal data (*Breyer*, C-582/14). That needs a legal basis and a notice entry for each site, which is disproportionate.
- A third-party favicon service only moves the leak.
- Serve every icon from Jobbbox's own assets, as #315 proposed. A favicon is itself a logo (§7), so for job sites and ATS show a generic glyph plus the domain in text, never a fetched favicon.

## Recommendation

**The pane must:**
- show only what served each item, read from what was stored with it (already decided in #314);
- name providers and models in plain text, in words the notice also uses;
- stay out of quota and price displays.

**The pane should:**
- show models by a display name with the provider, keeping the raw id on demand (#320);
- drop vendor logos and favicons in favour of Jobbbox glyphs and text;
- label tokens as technical and not counted;
- link « En savoir plus » to the « IA dans Jobbbox » section.

**The pane may:**
- show regions (EU or not) once the register states transfers truthfully.

**Owed elsewhere:**
1. **Coach first-turn disclosure** (art. 50(1)), in every Coach Conversation and in the Back Office Assistant, plus a persistent « Coach IA » badge, and a truthful answer when asked. This was due on 2 Aug 2026, so it is the most urgent item.
2. **Machine-readable marking** (art. 50(2)) of generated text, at the latest by 2 Dec 2026 if the transition applies:
   - ask Anthropic/AWS, Mistral and Perplexity whether their outputs carry a compliant mark (Guidelines 74);
   - otherwise, mark on our side: HTML metadata on generated blocks, and metadata in exported DOCX/PDF.
   - Short labels are exempt (68).
3. **Privacy notice and register:**
   - one entry per Candidate-side AI processing, with named processors;
   - fix the "no transfer outside the EU" line against ADR-0007's 2026-10-20 amendment;
   - one catalogue feeding both the notice and the pane.
4. **Legal page:** mentions légales, CGU or CGV for Plans, privacy notice, and the « IA dans Jobbbox » section.
5. **Exported documents:** a separate issue for marking downloads (§5).

## Needs counsel

1. Confirm Jobbbox's role as provider under art. 3(3) for systems built on third-party models via API, and whether any of its own uses also make it a deployer.
2. Whether a Candidate's job search is a "personal non-professional activity", which bears on deployer duties for documents they send.
3. Whether the 40+ audience and the emotional context call for periodic Coach reminders (Guidelines 40), and sign-off on the disclosure wording.
4. What "state of the art" marking means for plain text and DOCX/PDF, whether vendor marking can be relied on, and whether the 2 Dec 2026 transition covers Jobbbox's generative features.
5. Annex III point 4, once the final classification guidelines are out, especially before any B2B or outplacement feature that ranks Candidates for employers.
6. Processor and transfer mapping: AWS vs Anthropic on Bedrock, non-EU routes after 2026-10-20, and the web-search providers. Fix the register header.
7. Trademark use: text-only referring use is the low-risk path. Get written permission before showing any vendor logo, and do not use the State brand.
8. Consumer law, if tokens ever appear on subscription pages or in a Plan's terms.
9. The LCEN article numbering after the SREN law, and the content of the CGU/CGV.
