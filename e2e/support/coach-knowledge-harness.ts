import { loadCoachKnowledge, type KnowledgeEnvironment } from "@jobhub/coach-knowledge";

// Boots the coach-knowledge package through its public entry point in a fresh process and prints
// what a consumer (the AI Coach) would see, as one JSON line. argv: <environment> [dir].
const [environment, dir] = process.argv.slice(2);
try {
  const knowledge = loadCoachKnowledge({ environment: environment as KnowledgeEnvironment, ...(dir ? { dir } : {}) });
  const digest = knowledge.coreDigest();
  console.log(
    "CK_RESULT " +
      JSON.stringify({
        playbooks: knowledge.playbooks().map((p) => ({
          id: p.id,
          title: p.title,
          version: p.version,
          updated: p.updated,
          status: p.status,
          rules: p.rules,
          sources: p.sources,
          hasFrontmatter: p.text.startsWith("---"),
        })),
        digest: digest ? { ...digest, text: digest.text } : null,
      }),
  );
} catch (error) {
  console.log("CK_RESULT " + JSON.stringify({ error: { name: (error as Error).name, message: (error as Error).message } }));
}
