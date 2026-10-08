// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for
// Mistral's EU API (api.mistral.ai), the provider every AI task is routed to in
// the suite. Nothing ever reaches a real provider.
//
// For a Cover Letter or an Outreach Message (task writing), it says which
// language and Job Offer it was asked to write for, and, for an Outreach
// Message, by which channel, so tests can check the Document Language and the
// drafting request reached the AI Coach.
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
// For the offer analysis behind a Company Dossier (task offer_analysis), a posting
// whose displayed employer starts with "Cabinet" is a recruiting agency's, and its
// Presumed Employer is the name after "Client présumé : " in the posting.
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://api.mistral.ai/")) return realFetch(input, init);
  const body = JSON.parse(input instanceof Request ? await input.text() : String(init?.body ?? "{}"));
  const prompt = String(body.messages?.at(-1)?.content ?? "");
  if (prompt.includes("E2E_AI_DOWN")) return new Response("upstream unavailable", { status: 503 });

  let content = "fake reply";
  const system = String(body.messages?.find((message) => message.role === "system")?.content ?? "");
  if (system.includes("coach Jobbbox")) {
    const inView = /Le candidat consulte son profil « (.+?) »/.exec(system)?.[1];
    const turns = body.messages.filter((message) => message.role !== "system").length;
    content = `${inView ? `Je vois votre profil « ${inView} ».` : "Je ne vois aucun profil."} (${turns} message${turns > 1 ? "s" : ""})`;
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
    } else content = `Lettre de motivation (${language}) pour « ${title} ».`;
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
  return Response.json({
    id: "cmpl_e2e",
    model: body.model ?? "mistral-large-latest",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
};
