// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for
// Mistral's EU API (api.mistral.ai), the provider every AI task is routed to in
// the suite. Nothing ever reaches a real provider.
//
// For a Cover Letter or an Outreach Message (task writing), it says which
// language and Job Offer it was asked to write for, and, for an Outreach
// Message, by which channel, so tests can check the Document Language and the
// drafting request reached the AI Coach. When it was handed a Company Dossier,
// it says whose (and its SIREN), and, for an Outreach Message, the Suggested
// Contact Roles it was asked to address, so tests can check both reached it.
//
// For a Tailored CV (task writing, "Tu adaptes" / "You adapt"), it rephrases the
// reference CV it was handed: its headline gets "(adapté, <language>)", its first
// job's description "pour « <offer title> »"; it reverses its skills, cuts every
// job but the first, and tries to slip in "Power BI" and a "20 ans" figure, which
// the app must drop (ADR-0006). It reports "Management d'équipe" as missing.
// In English, it translates "Anglais"/"courant" into "English"/"fluent", keeping
// the language's id, as a real AI Coach writing in the Document Language would.
// Asked to translate the Job Offer's words (#68), it gives each word back as it is.
// A Job Offer holding "E2E_CV_REPLIES=<kind>,<kind>…@<id>" scripts its replies
// instead, one kind per call for that id (the last one repeats): "prose" (the CV
// retold in prose, no JSON), "truncated" (the JSON cut short), "bad_json" (a JSON
// object that does not parse) or "valid" (the reply above). Each such call prints
// "[fake-mistral] tailored-cv reply <n> for <id>: <kind>" to the server log, so
// tests can count how often the AI Coach was asked.
//
// For a CV (task cv_parsing, prompt "CV :\n<text>") it answers like the AI
// Coach would: the CV's first line as the name, its second as the title, and
// fixed Search Criteria the rule-based fallback could never produce, so tests
// can tell the AI reading was used. A CV containing "E2E_AI_DOWN" gets a 503,
// so tests can watch the fallback to the rule-based reading.
//
// For the AI Coach in the Coach Panel (task coaching), it says which Profile
// the system prompt put in view, if any, and how many messages it was sent, so
// tests can check the AI Coach knows what the Candidate is looking at.
//
// A Candidate message containing "E2E_SHOW_CONTEXT#<tag>" has the whole system prompt it was
// sent printed to the server log ("[fake-mistral] system prompt #<tag>: <JSON string>"), so tests
// can check what the AI Coach is told (#126; see support/system-prompt.ts). It is not sent back:
// a reply copying the system prompt is what the secret disclosure Guardrail replaces (#228).
// With a Coach Memory in its system prompt (#125), the AI Coach adds how many
// items it was told ("Mémoire : 2 éléments."), so tests can check it goes with
// every message. Asked what to remember from a conversation ("Tu relis une
// conversation"), it proposes each Candidate message as a goal, in order.
//
// For the Back Office Assistant (#205, "assistant du Back Office"), it says how many
// messages it was sent; "E2E_SHOW_CONTEXT#<tag>" prints the whole system prompt to the
// server log, so tests can check what the assistant is told for the asking Administrator's roles.
//
// The Guardrails' AI checks (#228, "Tu contrôles le message" / "Tu contrôles la réponse") find
// prompt injection in a message holding "E2E_GUARDRAIL_INJECTION" and out-of-scope advice in a
// reply holding "E2E_GUARDRAIL_ADVICE", nothing else; a message holding "E2E_GUARDRAIL_DOWN"
// makes them fail with a 503, so the checks are unavailable; "E2E_GUARDRAIL_ECHO", with a 400 whose body echoes the key, an email and a long text. "E2E_GUARDRAIL_DISTRESS" in a message is
// distress, "E2E_GUARDRAIL_LEAK" / "E2E_GUARDRAIL_SECRET" in a reply a leak / a secret.
// A message holding "E2E_COACH_SAY=<text>" (to the end of the line) has the AI Coach or the Back Office
// Assistant reply that text; written again (told its reply was blocked) it replies a clean text, unless the
// message also holds "E2E_STUBBORN" ("[at]", "[sp]", "[dash]" in the text become "@", a space and "-", so a reply can hold
// an email address, a phone number or a key the message does not). "E2E_COACH_COPY_SYSTEM" has the AI Coach reply its whole system prompt.
// "E2E_AGENT_LEAK" has a Playbook Agent's advice hold a third party's email address.
//
// For the offer analysis behind a Company Dossier (task offer_analysis), a posting
// whose displayed employer starts with "Cabinet" is a recruiting agency's, and its
// Presumed Employer is the name after "Client présumé : " in the posting.
//
// Asked which Playbook Agents the AI Coach should consult (#225, "Tu choisis quels Playbook
// Agents"), it names those the Candidate's message lists after "E2E_CONSULT=" (comma-separated),
// else none. A Playbook Agent (its system prompt holds its `<playbook id=… version=…>`) answers with
// advice naming its playbook, version, model and the reasoning_effort it was sent, citing [S24]; a
// message holding "E2E_AGENT_DOWN=<id>" makes that Playbook Agent fail with a 503.
//
// The AI judge of Eval Runs (#231, "Tu es le juge des évaluations") scores every reply 8 out of 10, or 2 when the
// criteria hold "E2E_JUDGE_LOW", with a reason in French.
//
// For the fields of a Job Offer read from its text (task offer_analysis, the second
// phase of a Match Score, #94), it finds none ("{}"), unless the text holds
// "E2E_OFFER_FIELDS=<json>", which it returns as the fields read. Either way it adds a
// Job Offer Summary, "Résumé du poste : <the offer's title>.", unless the json gives one. A text holding
// "E2E_ECHO_RULES" gets the last line of the rules it was sent as its summary instead (ADR-0026: the
// rules come from the job-offer-reading task Playbook).
const realFetch = globalThis.fetch;
/** Calls so far per scripted Tailored CV id (E2E_CV_REPLIES). */
const scriptedCalls = new Map();

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://api.mistral.ai/")) return realFetch(input, init);
  const body = JSON.parse(input instanceof Request ? await input.text() : String(init?.body ?? "{}"));
  const prompt = String(body.messages?.at(-1)?.content ?? "");
  if (prompt.includes("E2E_AI_DOWN")) return new Response("upstream unavailable", { status: 503 });

  let content = "fake reply";
  const system = String(body.messages?.find((message) => message.role === "system")?.content ?? "");
  if (system.startsWith("Tu contrôles le message") || system.startsWith("Tu contrôles la réponse")) {
    if (prompt.includes("E2E_GUARDRAIL_DOWN")) return new Response("upstream unavailable", { status: 503 });
    // No verdict within the check's time (#261: guardrail_timeout), and a verdict that is not JSON (invalid_verdict).
    if (prompt.includes("E2E_GUARDRAIL_SLOW")) await new Promise((resolve) => setTimeout(resolve, 12_000));
    if (prompt.includes("E2E_GUARDRAIL_GARBLED")) return completion(body, "this is not a verdict");
    // A provider refusing with an error that echoes the key, an email address and a long text (#259: stored scrubbed, redacted and cut).
    if (prompt.includes("E2E_GUARDRAIL_ECHO")) return new Response(`invalid key e2e-mistral-key for contact echo.person@example.fr ${"padding text ".repeat(80)}END_OF_ECHO`, { status: 400 });
    const verdict = system.startsWith("Tu contrôles le message")
      ? { prompt_injection: prompt.includes("E2E_GUARDRAIL_INJECTION"), distress: prompt.includes("E2E_GUARDRAIL_DISTRESS") }
      : { harmful_advice: prompt.includes("E2E_GUARDRAIL_ADVICE"), personal_data_leak: prompt.includes("E2E_GUARDRAIL_LEAK"), secret_disclosure: prompt.includes("E2E_GUARDRAIL_SECRET") };
    return completion(body, JSON.stringify(verdict));
  }
  if (system.startsWith("Tu es le juge des évaluations")) {
    const low = prompt.includes("E2E_JUDGE_LOW");
    return completion(body, JSON.stringify({ score: low ? 2 : 8, raison: low ? "E2E : la réponse ne remplit pas les critères." : "E2E : la réponse remplit les critères." }));
  }
  const shown = /E2E_SHOW_CONTEXT(#[\w-]+)?/.exec(prompt);
  const said = /E2E_COACH_SAY=(.*)/.exec(prompt)?.[1].trim();
  if (shown) console.log(`[fake-mistral] system prompt ${shown[1] ?? "#"}: ${JSON.stringify(system)}`);
  if (system.startsWith("Tu choisis quels Playbook Agents")) {
    content = JSON.stringify(/E2E_CONSULT=([\w,-]+)/.exec(prompt)?.[1].split(",") ?? []);
  }
  const playbook = /<playbook id="([^"]+)" version="(\d+)">/.exec(system);
  if (playbook) {
    if (new RegExp(`E2E_AGENT_DOWN=${playbook[1]}(?![\\w-])`).test(prompt)) return new Response("upstream unavailable", { status: 503 });
    content = `Avis du Playbook Agent ${playbook[1]} (version ${playbook[2]}, modèle ${body.model}, effort ${body.reasoning_effort ?? "aucun"}) : préparez trois exemples [S24].`;
    if (prompt.includes("E2E_AGENT_LEAK")) content += " Contact : agent.tiers@exemple.fr";
  }
  if (system.includes("coach Jobbbox")) {
    const inView = /Le candidat consulte son profil « (.+?) »/.exec(system)?.[1];
    const turns = body.messages.filter((message) => message.role !== "system").length;
    if (shown) content = `E2E: system prompt ${shown[1] ?? "#"} in the server log`;
    else if (prompt.includes("E2E_COACH_COPY_SYSTEM")) content = system;
    else if (said) content = saidText(said, system, prompt);
    else if (prompt.includes("E2E_COACH_MARKDOWN")) {
      // A model's habits (#164): Markdown, and "tu" unless the Coach is told to vouvoyer.
      const formal = system.includes("vouvoie");
      content = formal
        ? "Vous visez le poste de **Directrice des opérations** à **Lyon**.\n\nVos compétences :\n- *Consolidation* IFRS\n- Budget"
        : "Tu vises le poste de **Directrice des opérations** à **Lyon**.\n\nTes compétences :\n- *Consolidation* IFRS\n- Budget";
    } else if (prompt.includes("E2E_COACH_LONG")) {
      content = Array.from({ length: 30 }, (_, i) => `Paragraphe ${i + 1} : une réponse longue du Coach.`).join("\n\n") + "\n\nFIN DE LA RÉPONSE";
    }
    else {
      content = `${inView ? `Je vois votre profil « ${inView} ».` : "Je ne vois aucun profil."} (${turns} message${turns > 1 ? "s" : ""})`;
      const remembered = system.match(/^- (?:Objectif|Contrainte|Décision) : /gm)?.length ?? 0;
      if (remembered) content += ` Mémoire : ${remembered} élément${remembered > 1 ? "s" : ""}.`;
    }
  }
  if (system.includes("assistant du Back Office")) {
    const turns = body.messages.filter((message) => message.role !== "system").length;
    content = shown ? `E2E: system prompt ${shown[1] ?? "#"} in the server log` : said ? saidText(said, system, prompt) : `Réponse de l'assistant (${turns} message${turns > 1 ? "s" : ""})`;
  }
  if (system.includes("Tu relis une conversation")) {
    const said = [...prompt.matchAll(/^Candidat : (.+)$/gm)].map((match) => match[1].trim());
    content = JSON.stringify({ items: said.map((text) => ({ kind: "goal", text })) });
  }
  if (system.startsWith("Tu lis le texte d'une offre d'emploi.")) {
    const stated = /E2E_OFFER_FIELDS=(\{.*?\})(?:\s|$)/.exec(prompt)?.[1] ?? "{}";
    const title = prompt.split("\n")[0].trim();
    try {
      content = JSON.stringify({ summary: `Résumé du poste : ${title}.`, ...JSON.parse(stated) });
    } catch {
      content = stated;
    }
    if (prompt.includes("E2E_ECHO_RULES")) content = JSON.stringify({ summary: system.trim().split("\n").at(-1).trim() });
  }
  if (system.includes("cabinet de recrutement")) {
    const agency = /^Employeur affiché : Cabinet/m.test(prompt);
    const presumed = /Client présumé : (.+)/.exec(prompt)?.[1]?.trim() ?? null;
    content = JSON.stringify({ recruitingAgency: agency, presumedEmployer: agency ? presumed : null });
  }
  const writing = /^(?:Tu es le coach Jobbbox\. Tu rédiges|You are the Jobbbox coach\. You write)/.test(system);
  if (writing) {
    const language = system.startsWith("Tu es") ? "fr" : "en";
    const title = /"title":"([^"]*)"/.exec(prompt)?.[1] ?? "?";
    if (system.includes('"subject"')) {
      const channel = system.includes("InMail") ? "inmail" : "email";
      content = JSON.stringify({ subject: `Candidature (${language}) : ${title}`, text: `Message d'approche (${language}, ${channel}) pour « ${title} ».` });
    } else if (prompt.includes("E2E_FRAMED_LETTER")) {
      // A reply the way a model often writes it: Markdown, a sender block, placeholders, a repeated signature (#162).
      content =
        "**Marie Dupont**\n[Adresse]\n[Code postal, Ville]\n[Email] | [Téléphone]\n\n[Date]\n\n[Adresse de l'agence]\n\n**Objet : Candidature**\n\n" +
        "Madame, Monsieur,\n\nJ'ai piloté la **consolidation IFRS** d'un groupe industriel.\n\nJe vous prie d'agréer mes salutations distinguées.\n\n**Marie Dupont**";
    } else content = `Lettre de motivation (${language}) pour « ${title} ».`;
    const dossier = /^(?:Dossier sur l'entreprise|Company dossier) : (.+)$/m.exec(prompt)?.[1];
    if (dossier) {
      const facts = JSON.parse(dossier);
      const contacts = /^(?:Contacts à viser|Contacts to address)[^:]*: (.+)$/m.exec(prompt)?.[1];
      const extra = ` Dossier : ${facts.employer}${facts.siren ? ` (SIREN ${facts.siren})` : ""}.${contacts ? ` Contacts : ${contacts}.` : ""}`;
      if (system.includes('"subject"')) {
        const reply = JSON.parse(content);
        content = JSON.stringify({ ...reply, text: reply.text + extra });
      } else content += extra;
    }
  }
  // The Job Offer's words, "translated" for the Tailored CV's check (#68): each one as it is.
  if (system.startsWith("Translate each word of the list")) {
    content = JSON.stringify(Object.fromEntries(JSON.parse(prompt).map((word) => [word, word])));
  }
  if (/^(?:Tu es le coach Jobbbox\. Tu adaptes|You are the Jobbbox coach\. You adapt)/.test(system)) {
    const language = system.startsWith("Tu es") ? "fr" : "en";
    const title = /"title":"([^"]*)"/.exec(prompt)?.[1] ?? "?";
    const cv = JSON.parse(/^(?:CV de référence|Reference CV) : (.+)$/m.exec(prompt)?.[1] ?? "{}");
    const [first] = cv.experience ?? [];
    content = JSON.stringify({
      headline: `${cv.headline} (adapté, ${language})`,
      summary: "20 ans d'expérience en finance.",
      experience: first ? [{ ...first, description: `${first.description} pour « ${title} »` }] : [],
      education: cv.education ?? [],
      skills: ["Power BI", ...(cv.skills ?? []).toReversed()],
      languages: (cv.languages ?? []).map((item) =>
        language === "en" ? { ...item, name: item.name === "Anglais" ? "English" : item.name, level: item.level === "courant" ? "fluent" : item.level } : item,
      ),
      missing: ["Management d'équipe"],
    });
    const script = /E2E_CV_REPLIES=([a-z_,]+)@([\w-]+)/.exec(prompt);
    if (script) {
      const kinds = script[1].split(",");
      const n = (scriptedCalls.get(script[2]) ?? 0) + 1;
      scriptedCalls.set(script[2], n);
      const kind = kinds[Math.min(n, kinds.length) - 1];
      console.log(`[fake-mistral] tailored-cv reply ${n} for ${script[2]}: ${kind}`);
      if (kind === "prose") content = `Voici le CV adapté : ${cv.headline}, ${first?.employer ?? ""}. ${first?.description ?? ""} J'espère qu'il vous plaira.`;
      else if (kind === "truncated") content = content.slice(0, 60);
      else if (kind === "bad_json") content = `{"headline": "${cv.headline}", "summary": "${first?.description ?? ""}", }`;
    }
  }
  if (prompt.startsWith("CV :\n")) {
    const [fullName = "", headline = ""] = prompt.slice("CV :\n".length).split("\n");
    content = JSON.stringify({
      masterCv: {
        fullName,
        headline,
        email: "",
        phone: "",
        location: "Lyon",
        summary: "",
        experience: [{ title: headline, employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." }],
        education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
        skills: ["Consolidation", "IFRS"],
        languages: [{ name: "Anglais", level: "courant" }],
      },
      searchCriteria: { targetRole: `${headline} (lu par l'IA)`, location: "Lyon" },
    });
  }
  return completion(body, content);
};

/** What E2E_COACH_SAY has an assistant reply: the text, or a clean one when it is asked to write again (and not stubborn). */
function saidText(said, system, prompt) {
  if (system.includes("Ta réponse précédente a été bloquée") && !prompt.includes("E2E_STUBBORN")) return "Voici une réponse recentrée sur votre recherche d'emploi.";
  // "[at]", "[sp]", "[dash]" stand for "@", " " and "-": the reply holds what the message does not (an email address the Candidate never wrote).
  return said.replaceAll("[at]", "@").replaceAll("[sp]", " ").replaceAll("[dash]", "-");
}

/** A chat completion answering `content`. */
function completion(body, content) {
  return Response.json({
    id: "cmpl_e2e",
    model: body.model ?? "mistral-large-latest",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
}
