// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for
// Mistral's EU API (api.mistral.ai), the provider every AI task is routed to in
// the suite. Nothing ever reaches a real provider.
//
// For a CV (task cv_parsing, prompt "CV :\n<text>") it answers like the AI
// Coach would: the CV's first line as the name, its second as the title, and
// fixed Search Criteria the rule-based fallback could never produce, so tests
// can tell the AI reading was used. A CV containing "E2E_AI_DOWN" gets a 503,
// so tests can watch the fallback to the rule-based reading.
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://api.mistral.ai/")) return realFetch(input, init);
  const body = JSON.parse(input instanceof Request ? await input.text() : String(init?.body ?? "{}"));
  const prompt = String(body.messages?.at(-1)?.content ?? "");
  if (prompt.includes("E2E_AI_DOWN")) return new Response("upstream unavailable", { status: 503 });

  let content = "fake reply";
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
